import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { decodeHTML } from 'entities';
import { segmentText, sliceInline } from './segment';
import type { BookInfo, Pair } from '../shared';

const XHTML = 'http://www.w3.org/1999/xhtml';
const OPF = 'http://www.idpf.org/2007/opf';
const DC = 'http://purl.org/dc/elements/1.1/';
export interface Unit extends Pair { block: number; start: number; end: number }
interface Chapter { path: string; title: string; source: string; units: Unit[] }
export interface Cover { data: Buffer; mime: string }
export interface EpubBook {
  source: Buffer; hash: string; info: BookInfo; zip: JSZip; opfPath: string; opfSource: string;
  chapters: Chapter[]; units: Unit[]; coverPath?: string;
}

export function xml(source: string): JSDOM {
  // XHTML often contains HTML entity names. Resolve names locally without external DTD access.
  const normalized = source.replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (whole, name: string) => {
    if (['amp', 'lt', 'gt', 'quot', 'apos'].includes(name)) return whole;
    const decoded = decodeHTML(whole);
    return decoded === whole ? whole : [...decoded].map(c => `&#${c.codePointAt(0)};`).join('');
  });
  try { return new JSDOM(normalized, { contentType: 'application/xhtml+xml' }); }
  catch { throw new Error('书籍的 XML / XHTML 格式不完整，无法安全保留排版。请先用 Calibre 转换为标准 EPUB 后重试。'); }
}
export const byTag = (doc: Document | Element, tag: string) => [...doc.getElementsByTagNameNS('*', tag)];

export function archivePath(base: string, href: string): string {
  const plain = href.split('#')[0].split('?')[0];
  if (/^[a-zA-Z][\w+.-]*:/.test(plain) || plain.includes('\\')) throw new Error('书籍包含不支持的外部资源地址。');
  let decoded: string;
  try { decoded = decodeURIComponent(plain); } catch { decoded = plain; }
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(base), decoded));
  if (normalized.startsWith('../') || normalized.startsWith('/') || normalized === '..') throw new Error('EPUB 内部资源路径不合法。');
  return normalized;
}

function checkArchive(data: Buffer) {
  if (data.length > 200 * 1024 ** 2) throw new Error('当前版本支持 200 MB 以内的 EPUB。');
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('文件不是有效的 EPUB / ZIP。');
  const count = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16), total = 0;
  if (count > 20000 || count === 65535) throw new Error('EPUB 资源数量过多或使用了不支持的 ZIP64。');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) throw new Error('EPUB 压缩目录损坏。');
    const size = data.readUInt32LE(offset + 24);
    total += size;
    if (size > 48 * 1024 ** 2 || total > 450 * 1024 ** 2) throw new Error('EPUB 解压后的内容过大，无法处理。');
    if (data.readUInt16LE(offset + 8) & 1) throw new Error('无法读取加密的 EPUB。');
    offset += 46 + data.readUInt16LE(offset + 28) + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32);
  }
}

export function blocks(doc: Document): Element[] {
  const body = byTag(doc, 'body')[0];
  if (!body) return [];
  const tags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'blockquote', 'figcaption', 'div', 'section', 'article', 'dd', 'dt']);
  const boundaries = new Set([...tags, 'ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'figure', 'aside', 'header', 'footer', 'dl', 'hr', 'pre', 'nav']);
  const excluded = new Set(['script', 'style', 'code', 'pre', 'svg', 'math', 'nav']);
  const ignored = (el: Element) => {
    for (let p: Element | null = el; p && p !== body; p = p.parentElement) {
      if (excluded.has(p.localName) || p.getAttribute('translate') === 'no' || p.classList.contains('folio-translation')) return true;
    }
    return false;
  };
  const leaves = [...body.getElementsByTagName('*')].filter(el => {
    if (!tags.has(el.localName) || !el.textContent?.trim()) return false;
    if (ignored(el)) return false;
    return ![...el.getElementsByTagName('*')].some(child => boundaries.has(child.localName));
  });
  // Normalize direct inline runs inside containers which also contain block children.
  // This prevents the leading text of a list item/div from silently being skipped.
  const containers = [body, ...body.getElementsByTagName('*')].filter(el => !leaves.includes(el) &&
    (el === body || tags.has(el.localName)) && !ignored(el));
  for (const container of containers) {
    let run: Node[] = [];
    const flush = () => {
      if (run.some(n => n.textContent?.trim())) {
        const p = doc.createElementNS(XHTML, 'p');
        container.insertBefore(p, run[0]);
        for (const node of run) p.appendChild(node);
        leaves.push(p);
      }
      run = [];
    };
    for (const child of [...container.childNodes]) {
      if (child.nodeType === 1 && (boundaries.has((child as Element).localName) || excluded.has((child as Element).localName))) flush();
      else run.push(child);
    }
    flush();
  }
  return leaves.sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1);
}

export async function readEpub(filename: string, maxWords: number): Promise<EpubBook> {
  if (path.extname(filename).toLowerCase() !== '.epub') throw new Error('请选择 .epub 格式的电子书。');
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > 200 * 1024 ** 2) throw new Error('请选择 200 MB 以内的 EPUB 文件。');
  const source = await fs.readFile(filename);
  checkArchive(source);
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(source); } catch { throw new Error('EPUB 文件损坏，无法打开。'); }
  const getText = async (name: string) => {
    const file = zip.file(name);
    if (!file) throw new Error(`EPUB 缺少必要文件：${name}`);
    return file.async('string');
  };
  if (zip.file('META-INF/encryption.xml')) {
    const enc = xml(await getText('META-INF/encryption.xml'));
    const encrypted = byTag(enc.window.document, 'EncryptionMethod');
    const drm = encrypted.some(e => !['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'].includes(e.getAttribute('Algorithm') ?? ''));
    enc.window.close();
    if (drm) throw new Error('这本 EPUB 带有内容加密。请使用可正常读取的无加密 EPUB。');
  }
  const container = xml(await getText('META-INF/container.xml'));
  const opfPath = byTag(container.window.document, 'rootfile')[0]?.getAttribute('full-path');
  container.window.close();
  if (!opfPath || opfPath.includes('..') || opfPath.startsWith('/')) throw new Error('找不到 EPUB 的书籍清单。');
  const opfSource = await getText(opfPath);
  const opf = xml(opfSource), doc = opf.window.document;
  if (byTag(doc, 'meta').some(m => m.getAttribute('property') === 'rendition:layout' && m.textContent === 'pre-paginated')) {
    opf.window.close(); throw new Error('这本书是固定版式 EPUB；短句对照需要可重排的文字版 EPUB。');
  }
  const items = byTag(doc, 'item');
  const manifest = new Map(items.map(item => [item.getAttribute('id'), item]));
  const coverId = byTag(doc, 'meta').find(m => m.getAttribute('name') === 'cover')?.getAttribute('content');
  const coverItem = items.find(i => (i.getAttribute('properties') ?? '').split(/\s+/).includes('cover-image')) ?? manifest.get(coverId ?? null);
  const coverPath = coverItem ? archivePath(opfPath, coverItem.getAttribute('href') ?? '') : undefined;
  let cover: string | undefined;
  if (coverPath && zip.file(coverPath) && /image\/(jpeg|png|webp)/.test(coverItem?.getAttribute('media-type') ?? '')) {
    cover = `data:${coverItem!.getAttribute('media-type')};base64,${await zip.file(coverPath)!.async('base64')}`;
  }
  const title = byTag(doc, 'title')[0]?.textContent?.trim() || path.basename(filename, '.epub');
  const author = byTag(doc, 'creator').map(c => c.textContent?.trim()).filter(Boolean).join(' / ') || '作者未标注';
  const language = byTag(doc, 'language')[0]?.textContent?.trim() || 'en';
  const chapters: Chapter[] = [], units: Unit[] = [];
  const seen = new Set<string>();
  for (const ref of byTag(doc, 'itemref')) {
    const item = manifest.get(ref.getAttribute('idref'));
    if (!item || !['application/xhtml+xml', 'text/html'].includes(item.getAttribute('media-type') ?? '')) continue;
    if ((item.getAttribute('properties') ?? '').split(/\s+/).includes('nav')) continue;
    const chapterPath = archivePath(opfPath, item.getAttribute('href') ?? '');
    if (seen.has(chapterPath)) continue;
    seen.add(chapterPath);
    const content = await getText(chapterPath), dom = xml(content);
    if (dom.window.document.querySelector('.folio-translation')) { dom.window.close(); throw new Error('这本书已经包含对页译文。请导入原始 EPUB，避免重复翻译。'); }
    const chapterIndex = chapters.length;
    const candidates = blocks(dom.window.document);
    const chapterTitle = candidates.find(b => /^h[1-6]$/.test(b.localName))?.textContent?.trim() ||
      byTag(dom.window.document, 'title')[0]?.textContent?.trim() || `章节 ${chapterIndex + 1}`;
    const chapterUnits: Unit[] = [];
    candidates.forEach((block, blockIndex) => {
      const text = block.textContent ?? '';
      for (const range of segmentText(text, maxWords)) {
        if (!/[\p{L}]/u.test(range.text)) continue;
        chapterUnits.push({ id: `${chapterIndex}:${blockIndex}:${range.start}`, chapter: chapterIndex, block: blockIndex,
          start: range.start, end: range.end, source: range.text.trim(), heading: /^h[1-6]$/.test(block.localName) });
      }
    });
    dom.window.close();
    chapters.push({ path: chapterPath, title: chapterTitle, source: content, units: chapterUnits });
    units.push(...chapterUnits);
  }
  opf.window.close();
  if (!units.length) throw new Error('没有找到可翻译的文字。这可能是扫描图版 EPUB。');
  return { source, hash: createHash('sha256').update(source).digest('hex'), zip, opfPath, opfSource, chapters, units, coverPath,
    info: { title, author, filename: path.basename(filename), path: filename, language, cover,
      wordCount: units.reduce((sum, u) => sum + u.source.split(/\s+/).length, 0), chapterCount: chapters.length,
      chapters: chapters.map(c => ({ title: c.title, count: c.units.length })) } };
}

export async function writeEpub(book: EpubBook, translations: Record<string, string>, cover?: Cover): Promise<Buffer> {
  if (book.units.some(unit => !translations[unit.id]?.trim())) throw new Error('还有未完成的对照单元，请完成全书翻译后导出。');
  const zip = await JSZip.loadAsync(book.source);
  for (const chapter of book.chapters) {
    if (!chapter.units.length) continue;
    const dom = xml(chapter.source), doc = dom.window.document;
    const candidates = blocks(doc);
    const grouped = new Map<number, Unit[]>();
    for (const unit of chapter.units) grouped.set(unit.block, [...(grouped.get(unit.block) ?? []), unit]);
    for (const [index, units] of grouped) {
      const block = candidates[index];
      const fragment = doc.createDocumentFragment();
      const seen = new Set<string>();
      let cursor = 0;
      for (const unit of units) {
        // Include non-letter material skipped by the translator in the source span.
        const original = doc.createElementNS(XHTML, 'span');
        original.setAttribute('class', 'folio-source');
        original.setAttribute('lang', book.info.language);
        original.setAttribute('style', 'display:block;text-indent:0;margin-top:0.7em;');
        original.appendChild(sliceInline(block, cursor, unit.end, seen));
        cursor = unit.end;
        const translated = doc.createElementNS(XHTML, 'span');
        translated.setAttribute('class', 'folio-translation');
        translated.setAttribute('lang', 'zh-CN');
        translated.setAttribute('xml:lang', 'zh-CN');
        translated.setAttribute('style', 'display:block;text-indent:0;margin-top:0.25em;margin-bottom:0.9em;font-family:serif;line-height:1.65;');
        translated.textContent = translations[unit.id];
        fragment.append(original, translated);
      }
      if (cursor < (block.textContent?.length ?? 0)) fragment.appendChild(sliceInline(block, cursor, block.textContent!.length, seen));
      block.replaceChildren(fragment);
      block.classList.add('folio-paired');
    }
    zip.file(chapter.path, dom.serialize());
    dom.window.close();
  }
  const opf = xml(book.opfSource), doc = opf.window.document;
  const title = byTag(doc, 'title')[0];
  if (title) title.textContent = `${book.info.title} · 英中对照`;
  const metadata = byTag(doc, 'metadata')[0];
  if (metadata && !byTag(doc, 'language').some(l => l.textContent === 'zh-CN')) {
    const language = doc.createElementNS(DC, 'dc:language'); language.textContent = 'zh-CN'; metadata.appendChild(language);
  }
  // Give the derivative its own identifier so reader libraries do not replace the original.
  // Preserve the original identifier when font obfuscation depends on it.
  if (!zip.file('META-INF/encryption.xml')) {
    const root = doc.documentElement;
    const id = byTag(doc, 'identifier').find(i => i.getAttribute('id') === root.getAttribute('unique-identifier')) ?? byTag(doc, 'identifier')[0];
    if (id) {
      const identifier = `urn:uuid:${randomUUID()}`;
      id.textContent = identifier;
      for (const item of byTag(doc, 'item').filter(i => i.getAttribute('media-type') === 'application/x-dtbncx+xml')) {
        const name = archivePath(book.opfPath, item.getAttribute('href') ?? '');
        if (!zip.file(name)) continue;
        const ncx = xml(await zip.file(name)!.async('string'));
        for (const meta of byTag(ncx.window.document, 'meta')) if (meta.getAttribute('name') === 'dtb:uid') meta.setAttribute('content', identifier);
        for (const t of byTag(ncx.window.document, 'docTitle')) if (t.firstElementChild) t.firstElementChild.textContent = `${book.info.title} · 英中对照`;
        zip.file(name, ncx.serialize()); ncx.window.close();
      }
    }
  }
  for (const meta of byTag(doc, 'meta')) if (meta.getAttribute('property') === 'dcterms:modified') meta.textContent = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  if (cover) await applyCover(zip, book, doc, cover);
  zip.file(book.opfPath, opf.serialize()); opf.window.close();
  // EPUB requires an uncompressed mimetype as the first archive member.
  const ordered = new JSZip();
  ordered.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  for (const entry of Object.values(zip.files)) {
    if (entry.name === 'mimetype' || entry.dir) continue;
    ordered.file(entry.name, await entry.async('nodebuffer'));
  }
  return ordered.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

async function applyCover(zip: JSZip, book: EpubBook, doc: Document, cover: Cover) {
  const items = byTag(doc, 'item'), metadata = byTag(doc, 'metadata')[0], manifest = byTag(doc, 'manifest')[0];
  if (!metadata || !manifest) throw new Error('书籍清单不完整，无法更新封面。');
  let imageItem = items.find(i => book.coverPath && archivePath(book.opfPath, i.getAttribute('href') ?? '') === book.coverPath);
  if (imageItem && book.coverPath) {
    // Reuse the existing href: every cover-page reference stays valid.
    zip.file(book.coverPath, cover.data);
    imageItem.setAttribute('media-type', cover.mime);
    return;
  }
  const suffix = randomUUID().slice(0, 8);
  const imageHref = `folio-cover-${suffix}.jpg`, pageHref = `folio-cover-${suffix}.xhtml`;
  const imageId = `folio-image-${suffix}`, pageId = `folio-cover-${suffix}`;
  imageItem = doc.createElementNS(OPF, 'item');
  imageItem.setAttribute('id', imageId); imageItem.setAttribute('href', imageHref); imageItem.setAttribute('media-type', cover.mime);
  if (doc.documentElement.getAttribute('version')?.startsWith('3')) imageItem.setAttribute('properties', 'cover-image');
  const pageItem = doc.createElementNS(OPF, 'item');
  pageItem.setAttribute('id', pageId); pageItem.setAttribute('href', pageHref); pageItem.setAttribute('media-type', 'application/xhtml+xml');
  manifest.append(imageItem, pageItem);
  let meta = byTag(doc, 'meta').find(m => m.getAttribute('name') === 'cover');
  if (!meta) { meta = doc.createElementNS(OPF, 'meta'); meta.setAttribute('name', 'cover'); metadata.appendChild(meta); }
  meta.setAttribute('content', imageId);
  const ref = doc.createElementNS(OPF, 'itemref'); ref.setAttribute('idref', pageId);
  byTag(doc, 'spine')[0]?.prepend(ref);
  zip.file(archivePath(book.opfPath, imageHref), cover.data);
  zip.file(archivePath(book.opfPath, pageHref), `<?xml version="1.0" encoding="UTF-8"?><html xmlns="${XHTML}"><head><title>封面</title></head><body><div style="text-align:center"><img src="${imageHref}" alt="封面" style="max-width:100%;max-height:100%;"/></div></body></html>`);
}
