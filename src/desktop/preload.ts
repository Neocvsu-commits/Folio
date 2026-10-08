import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopApi, Snapshot } from '../shared';
const api: DesktopApi = {
  init: () => ipcRenderer.invoke('folio:init'),
  importBook: path => ipcRenderer.invoke('folio:import', path),
  drop: file => ipcRenderer.invoke('folio:import', webUtils.getPathForFile(file)),
  settings: config => ipcRenderer.invoke('folio:settings', config),
  test: config => ipcRenderer.invoke('folio:test', config),
  split: max => ipcRenderer.invoke('folio:split', max),
  translate: sample => ipcRenderer.invoke('folio:translate', sample),
  pause: () => ipcRenderer.invoke('folio:pause'),
  preview: chapter => ipcRenderer.invoke('folio:preview', chapter),
  cover: action => ipcRenderer.invoke('folio:cover', action),
  exportBook: () => ipcRenderer.invoke('folio:export'),
  reveal: () => ipcRenderer.invoke('folio:reveal'),
  external: target => ipcRenderer.invoke('folio:external', target),
  onState: callback => {
    const handler = (_event: Electron.IpcRendererEvent, state: Snapshot) => callback(state);
    ipcRenderer.on('folio:state', handler); return () => ipcRenderer.removeListener('folio:state', handler);
  },
  drag: () => ipcRenderer.send('folio:drag'),
  window: action => ipcRenderer.send('folio:window', action),
};
contextBridge.exposeInMainWorld('folio', api);
