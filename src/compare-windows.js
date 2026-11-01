"use strict";
const path = require('path');
function createCompareWindows({ BrowserWindow, screen, preload, index, state, authorize, log }) {
  const windows = new Map();
  function all() { return [...windows.values()].filter(w => !w.isDestroyed()); }
  function owns(win) { return all().includes(win); }
  function open(msg) {
    const current = state();
    let title, key, query;
    if (msg.view === 'cell') {
      const cell = current.folders.find(f => f.id === msg.folderId);
      if (!cell) throw new Error('格子已不存在');
      key = 'cell:' + cell.id; title = cell.name; query = { view: 'cell', id: cell.id };
    } else {
      const file = authorize(msg.path);
      key = 'preview:' + file; title = path.basename(file); query = { view: 'preview', path: file };
    }
    const existing = windows.get(key);
    if (existing && !existing.isDestroyed()) { if (existing.isMinimized()) existing.restore(); existing.show(); existing.focus(); return; }
    if (all().length >= 12) throw new Error('最多同时打开 12 个独立窗口，请先关闭不用的窗口');
    const area = screen.getPrimaryDisplay().workArea, offset = all().length % 6 * 28;
    const win = new BrowserWindow({ width: Math.min(760, area.width), height: Math.min(650, area.height), minWidth: 360, minHeight: 320,
      x: area.x + 30 + offset, y: area.y + 30 + offset, show: false, title: title + ' · folder-grid', backgroundColor: '#141c29',
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    windows.set(key, win);win.fgView = { ...query, root: current.root };
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.on('console-message', event => log('[对比窗口]', event.message));
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => windows.delete(key));
    win.loadFile(index, { query });
    return win;
  }
  function broadcast(payload) {
    for (const win of all()) {
      const view = win.fgView;
      if (view.root !== payload.root || (view.view === 'cell' && !payload.folders.some(f => f.id === view.id))) { win.destroy(); continue; }
      win.webContents.send('fg', { type: 'state', payload });
    }
  }
  return { open, all, owns, broadcast, closeAll: () => all().forEach(w => w.destroy()) };
}
module.exports = { createCompareWindows };
