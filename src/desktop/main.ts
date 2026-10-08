import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, safeStorage, Menu } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { DEFAULT_CONFIG, EMPTY, type PublicConfig, type ModelConfig, type Snapshot, type Result } from '../shared';
import { endpoint } from '../core/provider';
import { atomicWrite } from '../core/engine';

app.setName('Folio');
if (process.env.FOLIO_TEST_DATA) app.setPath('userData', process.env.FOLIO_TEST_DATA);
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
let win: BrowserWindow;
let worker: Worker;
let seq = 0;
const pending = new Map<number, { resolve: (data: unknown) => void; reject: (error: Error) => void }>();
let model: ModelConfig = { ...DEFAULT_CONFIG };
let preferences = { maxWords: 40, theme: 'light' as PublicConfig['theme'], lastBook: '' };
let state: Snapshot = structuredClone(EMPTY);
let opening = false, changing = false, closing = false;
let savedNotice = '';
let configFile = '';

function call<T>(method: string, data?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve: value => resolve(value as T), reject });
    worker.postMessage({ id, method, data });
  });
}
function publicConfig(): PublicConfig {
  const { apiKey, ...rest } = model;
  return { ...rest, hasKey: Boolean(apiKey), maxWords: preferences.maxWords, theme: preferences.theme };
}
async function saveSettings() {
  let encryptedKey = '';
  if (model.apiKey) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 密钥加密服务不可用，无法保存密钥。');
    encryptedKey = safeStorage.encryptString(model.apiKey).toString('base64');
  }
  const { apiKey: _key, ...settings } = model;
  await atomicWrite(configFile, JSON.stringify({ ...settings, ...preferences, encryptedKey }));
}
function ensureIdle() {
  if (state.phase === 'translating' || opening || changing) throw new Error('当前任务正在处理，请稍候或先暂停翻译。');
}
function currentOutput() {
  if (!state.outputPath || state.done !== state.total || state.phase !== 'complete') throw new Error('请先完成全书翻译。');
  return state.outputPath;
}
function validSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) { return event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame; }
function handle(name: string, fn: (arg: never) => Promise<unknown> | unknown) {
  ipcMain.handle(`folio:${name}`, async (event, arg): Promise<Result<unknown>> => {
    if (!validSender(event)) return { ok: false, error: '不允许的操作。' };
    try { return { ok: true, data: await fn(arg as never) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message.replaceAll(model.apiKey || '\0', '••••') : '操作失败。' }; }
  });
}

async function create() {
  configFile = path.join(app.getPath('userData'), 'settings.json');
  try {
    const saved = JSON.parse(await fs.readFile(configFile, 'utf8'));
    for (const key of ['provider', 'baseUrl', 'model', 'prompt', 'concurrency'] as const) if (saved[key] !== undefined) Object.assign(model, { [key]: saved[key] });
    preferences = { maxWords: Number.isInteger(saved.maxWords) ? Math.max(15, Math.min(100, saved.maxWords)) : 40,
      theme: ['light', 'dark', 'system'].includes(saved.theme) ? saved.theme : 'light', lastBook: typeof saved.lastBook === 'string' ? saved.lastBook : '' };
    if (saved.encryptedKey) {
      try { model.apiKey = safeStorage.decryptString(Buffer.from(saved.encryptedKey, 'base64')); }
      catch { savedNotice = '已保存的密钥无法解密，请重新填写 API 密钥。'; }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') savedNotice = '配置文件无法读取，已使用默认设置；原文件仍保留。';
  }
  worker = new Worker(path.join(__dirname, 'worker.cjs'), { workerData: { dataDir: app.getPath('userData'), config: model } });
  worker.on('message', message => {
    if (message.event === 'state') {
      state = message.state;
      if (win && !win.isDestroyed()) {
        win.webContents.send('folio:state', state);
        win.setProgressBar(state.phase === 'translating' ? state.done / Math.max(1, state.total) : -1);
      }
    } else {
      const task = pending.get(message.id); if (!task) return;
      pending.delete(message.id);
      if (message.ok) task.resolve(message.data); else task.reject(new Error(message.error));
    }
  });
  worker.on('error', () => {
    for (const task of pending.values()) task.reject(new Error('处理进程意外退出，请重新打开应用。已保存的进度会保留。'));
    pending.clear(); state.phase = 'error'; state.message = '处理进程意外退出，请重新打开应用。';
    win?.webContents.send('folio:state', state);
  });
  win = new BrowserWindow({ width: 1240, height: 920, minWidth: 980, minHeight: 780, show: !process.env.FOLIO_HEADLESS,
    title: '对页 · 双语制书', backgroundColor: '#ece9e2', frame: false, icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.on('close', event => {
    if (!closing && state.phase === 'translating') {
      event.preventDefault();
      void dialog.showMessageBox(win, { type: 'question', title: '暂停并退出', message: '当前正在翻译。暂停并保存进度后退出？',
        buttons: ['继续翻译', '暂停并退出'], defaultId: 0, cancelId: 0 }).then(async response => {
          if (response.response === 1) { await call('pause'); closing = true; win.close(); }
        });
    }
  });
  handle('init', () => ({ config: publicConfig(), state: savedNotice ? { ...state, message: savedNotice } : state, version: app.getVersion() }));
  handle('import', async (filename?: string) => {
    ensureIdle(); opening = true;
    try {
      if (!filename) {
        const result = await dialog.showOpenDialog(win, { title: '导入原书', filters: [{ name: 'EPUB 电子书', extensions: ['epub'] }], properties: ['openFile'] });
        if (result.canceled) return null; filename = result.filePaths[0];
      }
      if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw new Error('请选择有效的本地 EPUB 文件。');
      const opened = await call<Snapshot>('open', { path: filename, maxWords: preferences.maxWords });
      preferences.lastBook = filename; await saveSettings(); return opened;
    } finally { opening = false; }
  });
  handle('settings', async (value: Omit<PublicConfig, 'hasKey'> & { apiKey?: string; clearKey?: boolean }) => {
    ensureIdle(); changing = true;
    try {
      if (!value || typeof value.baseUrl !== 'string' || typeof value.model !== 'string') throw new Error('模型设置格式不正确。');
      endpoint(value.baseUrl);
      if (!value.model.trim()) throw new Error('请填写模型名称。');
      const previous = model, previousPrefs = { ...preferences };
      const sameEndpoint = value.baseUrl.trim() === model.baseUrl;
      model = { provider: ['deepseek', 'compatible', 'local'].includes(value.provider) ? value.provider : 'compatible',
        baseUrl: value.baseUrl.trim(), model: value.model.trim(), prompt: String(value.prompt || '').slice(0, 5000),
        concurrency: Math.min(4, Math.max(1, Number(value.concurrency) || 2)),
        apiKey: value.clearKey ? '' : value.apiKey?.trim() || (sameEndpoint ? model.apiKey : '') };
      preferences.theme = ['light', 'dark', 'system'].includes(value.theme) ? value.theme : 'light';
      try { await saveSettings(); await call('config', model); }
      catch (error) { model = previous; preferences = previousPrefs; await saveSettings(); throw error; }
      return publicConfig();
    } finally { changing = false; }
  });
  handle('test', async (value: ModelConfig & { clearKey?: boolean }) => {
    if (!value || typeof value.baseUrl !== 'string') throw new Error('模型设置格式不正确。');
    const config = { ...value, apiKey: value.apiKey?.trim() || (!value.clearKey && value.baseUrl.trim() === model.baseUrl ? model.apiKey : '') };
    return call<string>('test', config);
  });
  handle('split', async (max: number) => {
    ensureIdle(); changing = true;
    try { const result = await call<Snapshot>('split', max); preferences.maxWords = max; await saveSettings(); return result; }
    finally { changing = false; }
  });
  handle('translate', async (sample: boolean) => { ensureIdle(); await call('start', sample); return null; });
  handle('pause', async () => { await call('pause'); return null; });
  handle('preview', (chapter: number) => call('preview', Number.isInteger(chapter) ? chapter : 0));
  handle('cover', async (action: string) => {
    ensureIdle(); if (!state.book) throw new Error('请先导入 EPUB。');
    if (action === 'search') { await shell.openExternal(`https://www.bing.com/images/search?q=${encodeURIComponent(`${state.book.title} ${state.book.author} book cover`)}`); return null; }
    changing = true;
    try {
      if (action === 'reset' || action === 'undo') return await call<Snapshot>('cover', { undo: action === 'undo' });
      if (action !== 'choose') throw new Error('未知封面操作。');
      const result = await dialog.showOpenDialog(win, { title: '替换双语书封面', filters: [{ name: '封面图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }], properties: ['openFile'] });
      if (result.canceled) return null;
      const file = result.filePaths[0]; const stat = await fs.stat(file);
      if (stat.size > 25 * 1024 ** 2) throw new Error('封面图片请控制在 25 MB 以内。');
      const input = nativeImage.createFromBuffer(await fs.readFile(file));
      if (input.isEmpty()) throw new Error('这张图片无法读取，请选择 JPG、PNG 或 WebP。');
      const size = input.getSize();
      const resized = Math.max(size.width, size.height) > 2000 ? input.resize(size.width > size.height ? { width: 2000 } : { height: 2000 }) : input;
      return await call<Snapshot>('cover', { bytes: resized.toJPEG(92) });
    } finally { changing = false; }
  });
  handle('export', async () => {
    const output = currentOutput();
    const result = await dialog.showSaveDialog(win, { title: '保存双语 EPUB', defaultPath: path.join(app.getPath('documents'), path.basename(output)), filters: [{ name: 'EPUB 电子书', extensions: ['epub'] }] });
    if (result.canceled || !result.filePath) return null;
    const filename = result.filePath.toLowerCase().endsWith('.epub') ? result.filePath : `${result.filePath}.epub`;
    if (state.book && path.resolve(filename).toLowerCase() === path.resolve(state.book.path).toLowerCase()) throw new Error('请选择新的文件名，避免覆盖原书。');
    await atomicWrite(filename, await fs.readFile(output)); return filename;
  });
  handle('reveal', () => { shell.showItemInFolder(currentOutput()); return null; });
  handle('external', async (target: string) => {
    const urls: Record<string, string> = { weread: 'https://weread.qq.com/', docs: 'https://api-docs.deepseek.com/zh-cn/' };
    if (!urls[target]) throw new Error('未知链接。'); await shell.openExternal(urls[target]); return null;
  });
  ipcMain.on('folio:drag', event => {
    if (!validSender(event)) return;
    try { event.sender.startDrag({ file: currentOutput(), icon: nativeImage.createFromPath(path.join(__dirname, '../assets/icon.png')).resize({ width: 64 }) }); }
    catch { win.webContents.send('folio:state', { ...state, message: '拖出未成功，请使用“另存为 EPUB”。' }); }
  });
  ipcMain.on('folio:window', (event, action) => {
    if (!validSender(event)) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
    else if (action === 'close') win.close();
  });
  await win.loadFile(path.join(__dirname, 'ui/index.html'));
  if (preferences.lastBook) {
    opening = true;
    try { await call('open', { path: preferences.lastBook, maxWords: preferences.maxWords }); }
    catch { state.message = '上次的 EPUB 无法重新打开，请重新导入。'; win.webContents.send('folio:state', state); }
    finally { opening = false; }
  }
  // Development-only launch verification. Never runs in the packaged application.
  if (!app.isPackaged && process.env.FOLIO_SMOKE_PATH) {
    await new Promise(resolve => setTimeout(resolve, 1200));
    const image = await win.webContents.capturePage();
    await fs.writeFile(process.env.FOLIO_SMOKE_PATH, image.toPNG());
    await fs.writeFile(`${process.env.FOLIO_SMOKE_PATH}.json`, JSON.stringify({ title: win.getTitle(), ready: await win.webContents.executeJavaScript('Boolean(window.folio && document.querySelector("main"))') }));
    app.quit();
  }
}
if (single) {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(create).catch(error => { dialog.showErrorBox('对页无法启动', error instanceof Error ? error.message : '未知错误'); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { void worker?.terminate(); });
}
