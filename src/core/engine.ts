import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readEpub, writeEpub, type EpubBook, type Cover, type Unit } from './epub';
import { translateBatch, validateConfig } from './provider';
import { EMPTY, type ModelConfig, type Snapshot, type Pair } from '../shared';

export async function atomicWrite(filename: string, data: string | Buffer) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temp = `${filename}.${process.pid}.tmp`;
  const file = await fs.open(temp, 'w');
  try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
  await fs.rename(temp, filename);
}

export class Engine {
  book: EpubBook | null = null;
  state: Snapshot = structuredClone(EMPTY);
  translations: Record<string, string> = {};
  config: ModelConfig;
  cover?: Cover;
  coverHistory: (Cover | undefined)[] = [];
  controller?: AbortController;
  private cachePath = '';
  private saving = Promise.resolve();
  private runPromise?: Promise<void>;
  constructor(readonly dataDir: string, config: ModelConfig, readonly emit: (snapshot: Snapshot) => void) { this.config = config; }
  private notify() {
    this.state.done = this.book?.units.filter(u => Boolean(this.translations[u.id])).length ?? 0;
    this.state.preview = this.preview(0).slice(0, 12);
    this.emit(structuredClone(this.state));
  }
  private assertIdle() { if (this.runPromise) throw new Error('请先暂停当前翻译。'); }
  async open(filename: string, maxWords = 40) {
    this.assertIdle();
    const book = await readEpub(filename, maxWords);
    this.book = book;
    this.state = { ...structuredClone(EMPTY), book: { ...book.info }, total: book.units.length, maxWords, phase: 'ready' };
    this.cover = undefined; this.coverHistory = [];
    await this.loadCache();
    try {
      const data = await fs.readFile(path.join(this.dataDir, 'covers', `${book.hash}.jpg`));
      this.cover = { data, mime: 'image/jpeg' }; this.state.book!.resultCover = `data:image/jpeg;base64,${data.toString('base64')}`;
    } catch { /* No replacement cover yet. */ }
    this.state.message = this.state.done ? '已恢复上次的翻译进度。' : '原书已就绪，先试译几组看看效果。';
    if (this.state.done === this.state.total) { await this.generate(); this.state.phase = 'complete'; }
    this.notify(); return this.state;
  }
  async setConfig(config: ModelConfig) {
    this.assertIdle();
    const changed = ['baseUrl', 'model', 'prompt'].some(key => this.config[key as keyof ModelConfig] !== config[key as keyof ModelConfig]);
    this.config = config;
    if (changed && this.book) {
      await this.loadCache(); this.state.outputPath = null;
      this.state.phase = this.state.done === this.state.total ? 'complete' : 'ready';
      this.state.message = '模型设置已更新；按当前模型与排版恢复对应进度。';
      if (this.state.phase === 'complete') await this.generate();
      this.notify();
    }
  }
  private async loadCache() {
    if (!this.book) return;
    const hash = createHash('sha256').update(JSON.stringify({ version: 2, book: this.book.hash,
      words: this.state.maxWords, base: this.config.baseUrl, model: this.config.model, prompt: this.config.prompt, target: 'zh-CN' })).digest('hex');
    this.cachePath = path.join(this.dataDir, 'progress', `${hash}.json`);
    this.translations = {}; this.state.usage = { input: 0, output: 0 };
    try {
      const stored = JSON.parse(await fs.readFile(this.cachePath, 'utf8')) as { translations: Record<string, unknown>; usage?: Snapshot['usage'] };
      for (const unit of this.book.units) if (typeof stored.translations?.[unit.id] === 'string' && (stored.translations[unit.id] as string).trim()) this.translations[unit.id] = stored.translations[unit.id] as string;
      if (stored.usage && Number.isFinite(stored.usage.input) && Number.isFinite(stored.usage.output)) this.state.usage = stored.usage;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('上次的进度文件无法读取；已保留原文件，请检查应用数据目录。');
    }
    this.state.done = Object.keys(this.translations).length;
  }
  private save() {
    const data = JSON.stringify({ translations: this.translations, usage: this.state.usage });
    this.saving = this.saving.catch(() => {}).then(() => atomicWrite(this.cachePath, data));
    return this.saving;
  }
  preview(chapter: number): Pair[] {
    return this.book?.chapters[chapter]?.units.map(({id, source, heading}) => ({ id, source, chapter, heading, translation: this.translations[id] })) ?? [];
  }
  async split(maxWords: number) {
    this.assertIdle(); if (!this.book) throw new Error('请先导入 EPUB。');
    return this.open(this.book.info.path, maxWords);
  }
  start(sample: boolean) {
    this.assertIdle(); if (!this.book) throw new Error('请先导入 EPUB。');
    validateConfig(this.config);
    this.controller = new AbortController();
    this.state.phase = 'translating'; this.state.sample = sample; this.state.message = sample ? '正在试译前几组原文…' : '正在翻译，已完成的内容会自动保存。';
    this.notify();
    const promise = this.run(sample, this.controller.signal);
    this.runPromise = promise;
    void promise.finally(() => { this.runPromise = undefined; });
  }
  async pause() { this.controller?.abort(); await this.runPromise; }
  private async run(sample: boolean, signal: AbortSignal) {
    try {
      const wanted = sample ? this.book!.units.slice(0, 8) : this.book!.units;
      const remaining = wanted.filter(u => !this.translations[u.id]);
      const batches: Unit[][] = [];
      for (const unit of remaining) {
        const last = batches.at(-1);
        if (last && last.length < 8 && last[0].chapter === unit.chapter && last.reduce((sum, u) => sum + u.source.length, 0) + unit.source.length < 5500) last.push(unit);
        else batches.push([unit]);
      }
      let next = 0;
      const worker = async () => {
        while (next < batches.length && !signal.aborted) {
          const batch = batches[next++];
          this.state.currentChapter = this.book!.chapters[batch[0].chapter].title;
          this.notify();
          const chapter = this.book!.chapters[batch[0].chapter];
          const first = chapter.units.findIndex(u => u.id === batch[0].id);
          const context = chapter.units.slice(Math.max(0, first - 2), first + batch.length + 2).map(u => u.source).join(' ');
          const response = await translateBatch(this.config, batch, context, signal, () => {
            this.state.message = '当前请求未成功，正在重试；已有译文已保存。'; this.notify();
          });
          Object.assign(this.translations, response.translations);
          this.state.usage.input += response.input; this.state.usage.output += response.output;
          await this.save();
          this.state.message = '短句逐组对齐，翻译进度已保存。'; this.notify();
        }
      };
      // Wait for in-flight requests to settle before allowing file/config changes.
      const results = await Promise.allSettled(Array.from({ length: Math.min(this.config.concurrency, Math.max(1, batches.length)) }, () => worker().catch(error => { this.controller?.abort(); throw error; })));
      const failure = results.find(r => r.status === 'rejected' && !String(r.reason?.message).includes('已暂停')) as PromiseRejectedResult | undefined;
      if (failure && !String(failure.reason?.message).includes('已暂停')) throw failure.reason;
      if (signal.aborted) {
        this.state.phase = 'paused'; this.state.message = '已暂停，完成的译文已保存。点击继续即可接着翻译。';
      } else if (this.state.done === this.state.total) {
        this.state.message = '翻译完成，正在制作双语 EPUB…'; this.notify();
        await this.generate(); this.state.phase = 'complete'; this.state.sample = false; this.state.message = '双语书已完成。拖出右侧书籍，或另存为 EPUB。';
      } else {
        this.state.phase = 'ready'; this.state.message = '试译完成，可以在对照预览中查看。满意后继续翻译全书。';
      }
    } catch (error) {
      this.state.phase = 'error'; this.state.message = error instanceof Error ? error.message : '翻译失败，已有进度已保存。';
    } finally { this.notify(); }
  }
  async generate() {
    if (!this.book) throw new Error('请先导入 EPUB。');
    const bytes = await writeEpub(this.book, this.translations, this.cover);
    const name = this.book.info.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 90).replace(/[. ]+$/, '') || '双语书';
    const output = path.join(this.dataDir, 'exports', path.basename(this.cachePath, '.json'), `${name}（英中对照）.epub`);
    await atomicWrite(output, bytes); this.state.outputPath = output;
  }
  async setCover(cover?: Cover, undo = false) {
    this.assertIdle(); if (!this.book) throw new Error('请先导入 EPUB。');
    if (undo && !this.coverHistory.length) throw new Error('没有可撤销的封面修改。');
    if (undo) this.cover = this.coverHistory.pop();
    else { this.coverHistory.push(this.cover); this.cover = cover; if (this.coverHistory.length > 20) this.coverHistory.shift(); }
    const file = path.join(this.dataDir, 'covers', `${this.book.hash}.jpg`);
    if (this.cover) await atomicWrite(file, this.cover.data);
    else await fs.rm(file, { force: true });
    this.state.book!.resultCover = this.cover ? `data:${this.cover.mime};base64,${this.cover.data.toString('base64')}` : undefined;
    this.state.outputPath = null;
    if (this.state.done === this.state.total) await this.generate();
    this.state.message = undo ? '封面修改已撤销。' : '双语书封面已更新。'; this.notify(); return this.state;
  }
}
