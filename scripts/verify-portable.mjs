import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import net from 'node:net';

const exe = path.resolve(process.argv[2]);
const reportDir = path.resolve('work/portable-smoke');
await fs.mkdir(reportDir, { recursive: true });
const slot = net.createServer();
await new Promise(resolve => slot.listen(0, '127.0.0.1', resolve));
const port = slot.address().port;
await new Promise(resolve => slot.close(resolve));
const child = spawn(exe, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
  windowsHide: true, stdio: 'ignore',
  env: { ...process.env, FOLIO_HEADLESS: '1', FOLIO_TEST_DATA: path.join(reportDir, `profile-${Date.now()}`), FOLIO_SMOKE_PATH: '' },
});
let browser, page;
try {
  for (let i = 0; i < 80; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 500 }); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert.ok(browser, 'Packaged portable executable did not start.');
  page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => window.folio && document.querySelector('main'));
  const result = await page.evaluate(() => window.folio.init());
  assert.equal(result.ok, true); assert.equal(result.data.version, '0.1.0');
  assert.equal(await page.title(), '对页 · 双语制书');
  await fs.writeFile(path.join(reportDir, 'result.json'), JSON.stringify({ executable: exe, started: true, version: result.data.version, title: await page.title(), phase: result.data.state.phase }, null, 2));
  await page.evaluate(() => window.folio.window('close'));
  console.log('Portable executable startup verified.');
} finally {
  if (page && !page.isClosed()) await page.evaluate(() => window.folio?.window('close')).catch(() => {});
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}
