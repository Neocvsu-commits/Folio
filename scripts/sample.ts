import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import sharp from 'sharp';
import { readEpub, writeEpub } from '../src/core/epub';

const root = path.resolve(process.argv[2] || './examples');
await fs.mkdir(root, { recursive: true });
const paragraphs = [
  [
    ['A book is a quiet conversation between two people who may never meet, carried across time by the simple act of reading.', '一本书，是两个或许永远不会见面的人之间，一场安静的交谈。只是阅读这个简单的动作，就让它穿过了时间。'],
    ['When we read in another language, that conversation asks us to slow down, listen more carefully, and notice the shape of unfamiliar words.', '用另一种语言阅读时，这场交谈让我们放慢脚步，听得更仔细，也留意那些陌生词语的模样。'],
    ['A few lines of translation can help us find our way, without taking us away from the voice that made us open the book.', '几行译文便能帮我们找到方向，同时让我们留在那个最初吸引我们翻开书的声音里。'],
  ],
  [
    ['You do not have to understand every word before the story begins to mean something to you.', '你不必等到每个词都弄懂，才允许故事对你产生意义。'],
    ['Sometimes one clear sentence is enough to carry you into the next page, and the next page gives you a reason to stay.', '有时候，一句读懂的话就足以带你翻到下一页，而下一页又给了你继续读下去的理由。'],
  ],
  [
    ['Outside the window, the afternoon light moved slowly across the table while a small cup of tea cooled beside the open book.', '窗外的午后阳光缓缓移过桌面，摊开的书旁，一小杯茶渐渐凉了。'],
    ['Nothing remarkable happened, yet the room seemed larger because a stranger had found the words for something the reader had never quite explained.', '没有什么特别的事情发生，可房间仿佛变大了——一个陌生人，替读者说出了某种始终未能说清的感受。'],
    ['The translation was there when it was needed, close enough to be useful and quiet enough to let the original sentence keep its place.', '译文就在需要它的时候出现，离得足够近，能帮上忙；也足够安静，让原句依然待在属于它的位置。'],
  ],
  [
    ['Read a little. Return tomorrow. A language becomes familiar through many small meetings, not through a single perfect performance.', '读一点，明天再来。一种语言之所以渐渐熟悉，是因为许多次小小的相遇，而不是一次完美的表现。'],
  ],
];
const dictionary: [string, string][] = [['A Quiet Conversation', '一场安静的交谈'], ['By the Window', '窗边'], ...paragraphs.flat() as [string,string][]];
// This final paragraph consists of several short sentences; include sentence-level mappings too.
dictionary.pop();
dictionary.push(['Read a little.', '读一点。'], ['Return tomorrow.', '明天再来。'], ['A language becomes familiar through many small meetings, not through a single perfect performance.', '一种语言之所以渐渐熟悉，是因为许多次小小的相遇，而不是一次完美的表现。']);
const zip = new JSZip();
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
zip.file('EPUB/package.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:folio:sample:quiet-conversation</dc:identifier><dc:title>A Quiet Conversation</dc:title><dc:creator>对页 · 原创排版示例</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-08T00:00:00Z</meta><meta name="cover" content="cover-image"/></metadata><manifest><item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/></manifest><spine><itemref idref="cover"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>');
const html = (title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en"><head><title>${title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;
for (let chapter = 0; chapter < 2; chapter++) {
  const title = chapter === 0 ? 'A Quiet Conversation' : 'By the Window';
  const body = paragraphs.slice(chapter * 2, chapter * 2 + 2).map(p => `<p>${p.map(s => s[0]).join(' ')}</p>`).join('');
  zip.file(`EPUB/chapter${chapter + 1}.xhtml`, html(title, `<h1 id="title">${title}</h1>${body}`));
}
zip.file('EPUB/nav.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><h1>Contents</h1><ol><li><a href="chapter1.xhtml#title">A Quiet Conversation</a></li><li><a href="chapter2.xhtml#title">By the Window</a></li></ol></nav></body></html>');
zip.file('EPUB/cover.xhtml', html('Cover', '<div style="text-align:center"><img src="cover.png" alt="Book cover" style="max-width:100%;max-height:100%;"/></div>'));
zip.file('EPUB/style.css', 'body{margin:5%;line-height:1.7;}h1{font-family:serif;font-weight:normal;margin-bottom:1.5em;}p{text-indent:0;margin:1em 0;}');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1080"><rect width="720" height="1080" fill="#344b3f"/><rect x="48" y="48" width="624" height="984" fill="none" stroke="#d3c9a5" opacity=".4"/><g fill="none" stroke="#c8b98d" opacity=".7"><circle cx="325" cy="690" r="123"/><circle cx="395" cy="690" r="123"/><path d="M170 847H550M170 855H550"/></g><g fill="#e9e0c6" text-anchor="middle" font-family="Georgia,serif"><text x="360" y="172" font-size="15" letter-spacing="6">FOLIO READING SERIES</text><text x="360" y="315" font-size="52">A QUIET</text><text x="360" y="394" font-size="44">CONVERSATION</text><text x="360" y="474" font-size="19" letter-spacing="2">A LITTLE ROOM FOR UNDERSTANDING</text><text x="360" y="956" font-size="17" letter-spacing="5">AN ORIGINAL READING SAMPLE</text></g></svg>`;
zip.file('EPUB/cover.png', await sharp(Buffer.from(svg)).png().toBuffer());
const original = path.join(root, '示例原书-A-Quiet-Conversation.epub');
await fs.writeFile(original, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
const book = await readEpub(original, 40);
const translations: Record<string, string> = {};
for (const unit of book.units) {
  const matches = dictionary.filter(([source]) => unit.source.includes(source));
  assert.equal(matches.map(([source]) => source).join(' '), unit.source, `Unmapped source: ${unit.source}`);
  translations[unit.id] = matches.map(([,translation]) => translation).join('');
}
await fs.writeFile(path.join(root, '示例双语书-可导入微信读书.epub'), await writeEpub(book, translations));
console.log(`Created sample EPUBs with ${book.units.length} aligned units.`);
