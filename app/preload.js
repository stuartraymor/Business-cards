// Safe bridge between the page and the main process. The page gets only these functions.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cards', {
  list: opts => ipcRenderer.invoke('cards:list', opts),
  tags: () => ipcRenderer.invoke('cards:tags'),
  get: id => ipcRenderer.invoke('cards:get', id),
  duplicates: (data, excludeId) => ipcRenderer.invoke('cards:duplicates', data, excludeId),
  save: payload => ipcRenderer.invoke('cards:save', payload),
  remove: id => ipcRenderer.invoke('cards:delete', id),
  ocr: pngDataUrl => ipcRenderer.invoke('ocr', pngDataUrl),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  confirm: (message, detail) => ipcRenderer.invoke('dialog:confirm', message, detail),
  info: (message, detail) => ipcRenderer.invoke('dialog:info', message, detail),
  exportCards: (kind, cards) => ipcRenderer.invoke('export', kind, cards),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openDataFolder: () => ipcRenderer.invoke('app:open-data-folder'),
});
