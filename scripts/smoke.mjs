import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const project = process.cwd();
const folder = path.resolve(project, 'work/smoke-e2e');
await fs.mkdir(folder, { recursive: true });
const errors = [];
const server = http.createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  const input = JSON.parse(body);
  let content = '连接成功';
  if (input.messages.length > 1) {
    const payload = JSON.parse(input.messages[1].content);
    content = JSON.stringify({ translations: payload.units.map(unit => ({ id: unit.id, text: `这是桌面联调的测试译文，编号 ${unit.id}。` })) });
  }
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 7 } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/v1`;
const dataDir = path.join(folder, `profile-${Date.now()}`);
const executablePath = process.env.FOLIO_PACKAGED_EXE || path.join(project, 'node_modules/electron/dist/electron.exe');
const application = await electron.launch({ executablePath, args: process.env.FOLIO_PACKAGED_EXE ? [] : ['.'], cwd: project,
  env: { ...process.env, FOLIO_HEADLESS: '1', FOLIO_TEST_DATA: dataDir, FOLIO_SMOKE_PATH: '' } });
try {
  const page = await application.firstWindow();
  const screenshot = async name => {
    const data = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    await fs.writeFile(path.join(folder, name), Buffer.from(data, 'base64'));
  };
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('heading', { name: '让每一句，都读得懂。' })).toBeVisible();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '连接你的翻译模型' })).toBeVisible();
  await page.getByLabel('服务提供方').selectOption('local');
  await page.getByLabel('API 服务地址').fill(url);
  await page.getByLabel('模型名称').fill('integration-test');
  await page.locator('input[type="password"]').fill('local-test-only-not-a-real-key');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByText(/连接成功，模型已返回响应/)).toBeVisible();
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  const settingsText = await fs.readFile(path.join(dataDir, 'settings.json'), 'utf8');
  assert.ok(!settingsText.includes('local-test-only-not-a-real-key'));
  assert.ok(JSON.parse(settingsText).encryptedKey.length > 0);
  const source = path.resolve(process.env.FOLIO_SAMPLE || path.join(project, 'examples/示例原书-A-Quiet-Conversation.epub'));
  const opened = await page.evaluate(file => window.folio.importBook(file), source);
  assert.equal(opened.ok, true, opened.error);
  await page.getByLabel('每组原文词数', { exact: true }).fill('30');
  await page.getByLabel('每组原文词数', { exact: true }).press('Tab');
  await expect.poll(async () => (await page.evaluate(() => window.folio.init())).data.state.maxWords).toBe(30);
  await page.getByLabel('每组原文词数', { exact: true }).fill('40');
  await page.getByLabel('每组原文词数', { exact: true }).press('Tab');
  await expect.poll(async () => (await page.evaluate(() => window.folio.init())).data.state.maxWords).toBe(40);
  await expect(page.getByRole('button', { name: '先试译 8 组', exact: true })).toBeEnabled();
  const before = await page.evaluate(() => window.folio.init());
  assert.equal(before.data.state.done, 0);
  await page.getByRole('button', { name: '先试译 8 组', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.folio.init())).data.state.done).toBe(8);
  await page.getByRole('button', { name: '对照预览', exact: true }).click();
  await expect(page.getByRole('heading', { name: '短句对照预览' })).toBeVisible();
  await page.getByLabel('预览章节').selectOption('1');
  await expect(page.locator('.reading-translation').first()).toContainText('测试译文');
  await screenshot('preview.png');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '继续翻译全书', exact: true }).click();
  await expect(page.getByRole('button', { name: '另存为 EPUB', exact: true })).toBeVisible({ timeout: 15000 });
  const finished = await page.evaluate(() => window.folio.init());
  assert.equal(finished.data.state.phase, 'complete');
  assert.ok(await fs.stat(finished.data.state.outputPath));
  const output = path.join(folder, 'exported.epub');
  await application.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, output);
  await page.getByRole('button', { name: '另存为 EPUB', exact: true }).click();
  await expect.poll(async () => (await fs.stat(output).catch(() => null))?.size || 0).toBeGreaterThan(0);
  const cover = path.resolve(project, 'assets/icon.png');
  await application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, cover);
  await page.getByRole('button', { name: '更换双语书封面；完成后可拖出 EPUB' }).click();
  await page.getByRole('button', { name: /从电脑选择图片/ }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  assert.match((await page.evaluate(() => window.folio.init())).data.state.book.resultCover, /^data:image\/jpeg/);
  const undo = await page.evaluate(() => window.folio.cover('undo'));
  assert.equal(undo.ok, true); assert.equal(undo.data.book.resultCover, undefined);
  // Verify that the gesture passes the completed file to Electron's native drag API.
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.startDrag = item => { globalThis.__dragged = item.file; }; });
  await page.locator('.book-object.translated').dispatchEvent('dragstart');
  await expect.poll(() => application.evaluate(() => globalThis.__dragged)).toBe(finished.data.state.outputPath);
  await screenshot('complete.png');
  await page.getByRole('button', { name: '切换深浅主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await screenshot('dark.png');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(folder, 'results.json'), JSON.stringify({ ready: true, checks: ['settings', 'test-api', 'import', 'sample', 'preview', 'resume', 'export', 'cover', 'cover-undo', 'native-drag-dispatch', 'theme'], units: finished.data.state.total, errors }, null, 2));
  console.log(`Desktop integration passed: ${finished.data.state.total} units, ${errors.length} renderer errors.`);
} finally { await application.close(); server.closeAllConnections(); server.close(); }
