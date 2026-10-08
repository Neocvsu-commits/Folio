import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import JSZip from 'jszip';
import { fixture } from './fixture';
import { segmentText, sliceInline } from '../src/core/segment';
import { archivePath, readEpub, writeEpub, xml, blocks } from '../src/core/epub';
import { Engine } from '../src/core/engine';
import { endpoint, parseTranslations } from '../src/core/provider';
import { DEFAULT_CONFIG, type Snapshot } from '../src/shared';

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'folio-test-'));

test('splitting preserves every character and bounds long English sentences', () => {
  const texts = [
    '  Dr. Smith went home. He read a long book, and then he went for a walk.\n\nThe next morning was quiet.  ',
    `${'long '.repeat(147)}sentence.`, 'A short sentence. Another short one.',
    '中文'.repeat(400), 'Hello & goodbye. Numbers like 3.14 matter. “Keep reading,” she said.',
  ];
  for (const text of texts) {
    const ranges = segmentText(text, 20);
    assert.equal(ranges.map(r => r.text).join(''), text);
    assert.ok(ranges.every(r => r.text.trim().split(/\s+/).length <= 20));
    for (const range of ranges) assert.equal(text.slice(range.start, range.end), range.text);
  }
});

test('inline slices preserve text, emphasis, references, and images exactly once', () => {
  const dom = xml('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Test</title></head><body><p><img src="before.png"/>One <em id="same">two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo</em> last.<img src="after.png"/></p></body></html>');
  const p = dom.window.document.querySelector('p')!;
  const output = dom.window.document.createElementNS(p.namespaceURI, 'div');
  const seen = new Set<string>();
  for (const r of segmentText(p.textContent!, 15)) output.appendChild(sliceInline(p, r.start, r.end, seen));
  assert.equal(output.textContent, p.textContent);
  assert.equal(output.querySelectorAll('img').length, 2);
  assert.equal(output.querySelectorAll('#same').length, 1);
  assert.equal([...output.querySelectorAll('em')].map(e => e.textContent).join(''), p.querySelector('em')!.textContent);
  dom.window.close();
});

test('EPUB round trip keeps package, nested TOC, assets, source text and unique IDs', async () => {
  const dir = await temp();
  try {
    const source = path.join(dir, 'book.epub'); await fs.writeFile(source, await fixture());
    const book = await readEpub(source, 20);
    assert.ok(book.units.length > 6);
    assert.ok(book.units.some(u => u.source === 'Leading words.'));
    assert.ok(book.units.some(u => u.source === 'Trailing words.'));
    assert.ok(!book.units.some(u => u.source.includes('print(')));
    const translations = Object.fromEntries(book.units.map(u => [u.id, `中文 < & > ${u.id}`]));
    const result = await writeEpub(book, translations);
    assert.equal(result.readUInt32LE(0), 0x04034b50);
    assert.equal(result.readUInt16LE(8), 0, 'mimetype is uncompressed');
    assert.equal(result.subarray(30, 38).toString(), 'mimetype');
    const zip = await JSZip.loadAsync(result);
    assert.equal(await zip.file('Books/nav.xhtml')!.async('string'), await book.zip.file('Books/nav.xhtml')!.async('string'));
    assert.deepEqual(await zip.file('Books/art.png')!.async('nodebuffer'), await book.zip.file('Books/art.png')!.async('nodebuffer'));
    const dom = xml(await zip.file('Books/Text/chapter.xhtml')!.async('string'));
    const original = xml(book.chapters[0].source);
    assert.equal(dom.window.document.querySelectorAll('.folio-translation').length, book.units.length);
    for (const translated of dom.window.document.querySelectorAll('.folio-translation')) translated.remove();
    assert.equal(dom.window.document.body.textContent, original.window.document.body.textContent);
    assert.equal(dom.window.document.querySelector('a#noteref')?.getAttribute('href'), '#note');
    assert.equal(dom.window.document.querySelectorAll('p > ul').length, 0);
    const ids = [...dom.window.document.querySelectorAll('[id]')].map(e => e.id);
    assert.equal(ids.length, new Set(ids).size);
    const opf = await zip.file('Books/package.opf')!.async('string');
    assert.match(opf, /Folio Studio/); assert.match(opf, /英中对照/); assert.ok(!opf.includes('urn:test:folio-original'));
    dom.window.close(); original.window.close();
    await assert.rejects(writeEpub(book, {}), /未完成/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('covers replace existing references and create a cover when absent', async () => {
  const dir = await temp();
  try {
    for (const hasCover of [false, true]) {
      const file = path.join(dir, 'cover.epub'); await fs.writeFile(file, await fixture({cover: hasCover}));
      const book = await readEpub(file, 40), translations = Object.fromEntries(book.units.map(u => [u.id, '示例中文']));
      const zip = await JSZip.loadAsync(await writeEpub(book, translations, { data: Buffer.from('test-image'), mime: 'image/jpeg' }));
      const opf = await zip.file('Books/package.opf')!.async('string');
      assert.match(opf, /media-type="image\/jpeg"/);
      if (hasCover) assert.equal(await zip.file('Books/art.png')!.async('string'), 'test-image');
      else assert.ok(Object.keys(zip.files).some(f => f.match(/folio-cover.*\.xhtml$/)));
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('reject invalid archives and escape model output instead of accepting HTML', async () => {
  const dir = await temp();
  try {
    const file = path.join(dir, 'invalid.epub'); await fs.writeFile(file, 'not a zip');
    await assert.rejects(readEpub(file, 40), /有效/);
    assert.throws(() => archivePath('Book/package.opf', '../../../x'), /路径/);
    assert.throws(() => endpoint('http://example.com'), /HTTPS/);
    assert.equal(endpoint('https://example.com/v1/'), 'https://example.com/v1/chat/completions');
    assert.equal(endpoint('https://example.com/v1/chat/completions'), 'https://example.com/v1/chat/completions');
    const units = [{ id: 'a', source: 'First.' }, {id: 'b', source: 'Second.'}];
    assert.throws(() => parseTranslations('{"translations":[{"id":"a","text":"一"}]}', units), /漏译/);
    assert.throws(() => parseTranslations('{"translations":[{"id":"a","text":"一"},{"id":"a","text":"二"}]}', units), /不匹配/);
    assert.deepEqual(parseTranslations('```json\n{"translations":[{"id":"b","text":"二"},{"id":"a","text":"一"}]}\n```', units), { b: '二', a: '一' });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('engine completes sample, resumes from disk, pauses in-flight calls and exports only complete books', async () => {
  const dir = await temp(); let requests = 0, delay = 0;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body); requests++;
    const input = JSON.parse(payload.messages[1].content);
    const data = { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: input.units.map((u: { id: string }) => ({ id: u.id, text: `示例译文 ${u.id}` })) }) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } };
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const config = { ...DEFAULT_CONFIG, provider: 'local' as const, baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'test', concurrency: 2 };
  async function settled(engine: Engine) {
    const deadline = Date.now() + 20000;
    while (engine.state.phase === 'translating') { if (Date.now() > deadline) throw new Error('timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  try {
    const file = path.join(dir, 'original.epub'); await fs.writeFile(file, await fixture({ many: true }));
    const events: Snapshot[] = [];
    const engine = new Engine(dir, config, state => events.push(state));
    await engine.open(file, 20); engine.start(true); await settled(engine);
    assert.equal(engine.state.done, 8); assert.equal(engine.state.phase, 'ready'); assert.equal(engine.state.outputPath, null);
    const count = requests;
    const resumed = new Engine(dir, config, () => {}); await resumed.open(file, 20);
    assert.equal(resumed.state.done, 8); assert.equal(requests, count);
    delay = 400; resumed.start(false); await new Promise(resolve => setTimeout(resolve, 40)); await resumed.pause();
    assert.equal(resumed.state.phase, 'paused'); assert.equal(resumed.state.done, 8);
    delay = 0; resumed.start(false); await settled(resumed);
    assert.equal(resumed.state.phase, 'complete'); assert.equal(resumed.state.done, resumed.state.total);
    assert.ok(resumed.state.outputPath); assert.ok((await fs.stat(resumed.state.outputPath!)).size > 0);
    assert.ok(events.every((e, i) => i === 0 || e.done >= events[i - 1].done));
    assert.deepEqual(await fs.readFile(file), resumed.book!.source, 'source file remains unchanged');
    await resumed.setConfig({ ...config, model: 'another-model' });
    assert.equal(resumed.state.done, 0); assert.equal(resumed.state.outputPath, null);
  } finally { server.closeAllConnections(); server.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
