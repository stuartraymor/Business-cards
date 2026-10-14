// Business Cards - Electron main process: window, data folder, OCR, clipboard, export.
'use strict';

const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const { CardStore } = require('./store.js');
const { toCsv, toVcards } = require('./exporter.js');

const APP_NAME = 'Business Cards';
const DATA_DIR = path.join(app.getPath('appData'), 'BusinessCards');

// Only one copy of the app runs at a time.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;
let store = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    title: APP_NAME,
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#edf0ec',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('closed', () => { win = null; });
}

function dataUrlToBuffer(dataUrl) {
  return Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');
}

function runOcr(pngPath) {
  const ps1 = path.join(__dirname, 'ocr.ps1');
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Path', pngPath], { windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { try { p.kill(); } catch (_) { } reject(new Error('Text recognition took too long.')); }, 60000);
    p.stdout.on('data', d => { out += d.toString('utf8'); });
    p.stderr.on('data', d => { err += d.toString('utf8'); });
    p.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out.replace(/\r/g, '').trim());
      else if (/NO_ENGINE/.test(err)) reject(new Error('No text-recognition language is installed in Windows (Settings > Time & language > Language).'));
      else reject(new Error('Windows text recognition is not available on this computer.'));
    });
    p.on('error', () => { clearTimeout(timer); reject(new Error('PowerShell could not start.')); });
  });
}

function registerIpc() {
  ipcMain.handle('cards:list', (_e, opts) => store.list(opts || {}));
  ipcMain.handle('cards:tags', () => store.allTags());
  ipcMain.handle('cards:get', (_e, id) => {
    const card = store.get(id);
    if (!card) return null;
    const imgPath = store.imagePath(card.imageName);
    const imageDataUrl = imgPath ? 'data:image/png;base64,' + fs.readFileSync(imgPath).toString('base64') : '';
    return { card, imageDataUrl };
  });
  ipcMain.handle('cards:duplicates', (_e, data, excludeId) => store.findDuplicates(data, excludeId));
  ipcMain.handle('cards:save', (_e, { id, data, pngDataUrl, rawText }) => {
    if (id) {
      store.update(id, data);
      return id;
    }
    const png = pngDataUrl ? dataUrlToBuffer(pngDataUrl) : null;
    return store.add(data, png, rawText);
  });
  ipcMain.handle('cards:delete', (_e, id) => { store.remove(id); return true; });

  ipcMain.handle('ocr', async (_e, pngDataUrl) => {
    if (process.platform !== 'win32') throw new Error('Text recognition uses Windows, so it only works on Windows.');
    const dir = path.join(os.tmpdir(), 'businesscards');
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `ocr-${Date.now()}.png`);
    fs.writeFileSync(tmp, dataUrlToBuffer(pngDataUrl));
    try {
      return await runOcr(tmp);
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) { }
    }
  });

  ipcMain.handle('clipboard:read', () => {
    const img = clipboard.readImage();
    if (!img.isEmpty()) return { type: 'image', dataUrl: img.toDataURL() };
    const text = clipboard.readText().trim();
    if (text) return { type: 'text', text };
    return null;
  });

  ipcMain.handle('dialog:confirm', async (_e, message, detail) => {
    const r = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Yes', 'No'], defaultId: 0, cancelId: 1, message, detail,
    });
    return r.response === 0;
  });
  ipcMain.handle('dialog:info', async (_e, message, detail) => {
    await dialog.showMessageBox(win, { type: 'info', buttons: ['OK'], message, detail });
    return true;
  });

  ipcMain.handle('export', async (_e, kind, cards) => {
    const isCsv = kind === 'csv';
    const r = await dialog.showSaveDialog(win, {
      title: isCsv ? 'Export to Excel (CSV)' : 'Export contacts (vCard)',
      defaultPath: path.join(app.getPath('documents'), isCsv ? 'business-cards.csv' : 'business-cards.vcf'),
      filters: isCsv ? [{ name: 'CSV', extensions: ['csv'] }] : [{ name: 'vCard', extensions: ['vcf'] }],
    });
    if (r.canceled || !r.filePath) return { saved: false };
    fs.writeFileSync(r.filePath, isCsv ? toCsv(cards) : toVcards(cards), 'utf8');
    shell.showItemInFolder(r.filePath);
    return { saved: true, count: cards.length, path: r.filePath };
  });

  ipcMain.handle('app:info', () => ({ name: APP_NAME, version: app.getVersion(), dataDir: DATA_DIR }));
  ipcMain.handle('app:open-data-folder', () => shell.openPath(DATA_DIR));
}

app.whenReady().then(() => {
  if (!gotLock) return;
  store = new CardStore(DATA_DIR);
  registerIpc();
  createWindow();
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.on('window-all-closed', () => app.quit());
