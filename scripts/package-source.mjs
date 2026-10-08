import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
const root = process.cwd();
const target = path.resolve(process.argv[2] || 'release/Folio-0.1.0-source.zip');
const archive = new JSZip();
async function add(relative) {
  const file = path.join(root, relative);
  const stat = await fs.stat(file);
  if (stat.isDirectory()) { for (const name of await fs.readdir(file)) await add(path.join(relative, name)); }
  else archive.file(`Folio-source/${relative.split(path.sep).join('/')}`, await fs.readFile(file));
}
for (const item of ['src', 'scripts', 'tests', 'assets', 'examples', 'README.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html', '.gitignore']) await add(item);
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.writeFile(target, await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
console.log(`Source archive: ${Object.keys(archive.files).length} entries.`);
