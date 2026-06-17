'use strict';
// DK-QUAKE launcher: multi-grid panel + PC config editor, on the open Aris68Connector driver.
const { app, BrowserWindow, screen, powerSaveBlocker, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const HID = require('node-hid');
const Aris68Connector = require(path.join(__dirname, '..', 'src', 'Aris68Connector'));
let robot = null; try { robot = require('robotjs'); } catch (e) { console.log('robotjs unavailable (knob-volume off):', e.message); }

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'config.default.json');
let config = loadConfig();
let panelWin = null, configWin = null;
const dev = new Aris68Connector({ hid: HID });

// On first run there is no user config.json (it's gitignored so personal setups never get committed);
// seed it from the shipped default so a fresh clone is immediately usable.
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(DEFAULT_CONFIG_PATH)) fs.copyFileSync(DEFAULT_CONFIG_PATH, CONFIG_PATH);
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) { console.log('config load error:', e.message); return { activeGridId: null, grids: [] }; }
}
function saveConfig() { try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); } catch (e) { console.log('config save error:', e.message); } }
function activeGrid() { return config.grids.find(g => g.id === config.activeGridId) || config.grids[0] || { cols: 8, rows: 2, tiles: [] }; }
function gridList() { return config.grids.map(g => ({ id: g.id, name: g.name })); }
function pushToPanel() {
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.webContents.send('grid', activeGrid());
    panelWin.webContents.send('gridList', { grids: gridList(), activeId: config.activeGridId });
  }
}

function runAction(a) {
  if (!a || !a.type) return;
  if (a.type === 'system' && a.value === 'config') return openConfigWindow();
  console.log('launch:', a.label, '->', a.type, a.value);
  try {
    switch (a.type) {
      case 'url': shell.openExternal(a.value); break;
      case 'app': exec(`start "" "${a.value}"`, { windowsHide: true }); break;
      case 'cmd': exec(a.value, { windowsHide: true }); break;
      case 'open': shell.openPath(a.value); break;
      case 'system': if (a.value === 'lock') exec('rundll32.exe user32.dll,LockWorkStation'); break;
    }
  } catch (e) { console.log('action error:', e.message); }
}

function deviceDisplay() {
  return screen.getAllDisplays().find(d => (d.bounds.width === 480 && d.bounds.height === 1920) || (d.bounds.width === 1920 && d.bounds.height === 480));
}
function placePanel() {
  const d = deviceDisplay();
  if (!d) { console.log('placePanel: DK-QUAKE display not present'); return; }
  if (!panelWin || panelWin.isDestroyed()) {
    panelWin = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, show: false, skipTaskbar: true, backgroundColor: '#000000',
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    panelWin.loadFile(path.join(__dirname, 'index.html'));
    panelWin.once('ready-to-show', () => {
      const dd = deviceDisplay() || d;
      panelWin.setBounds(dd.bounds); panelWin.setAlwaysOnTop(true); panelWin.show(); panelWin.focus();
      setTimeout(() => panelWin.setAlwaysOnTop(false), 1500);
      pushToPanel();
      console.log('panel placed at', JSON.stringify(panelWin.getBounds()));
    });
  } else { panelWin.setBounds(d.bounds); panelWin.show(); pushToPanel(); }
}

function openConfigWindow() {
  if (configWin && !configWin.isDestroyed()) { configWin.show(); configWin.focus(); return; }
  const prim = screen.getPrimaryDisplay().bounds;
  configWin = new BrowserWindow({
    width: 1100, height: 720, x: prim.x + 80, y: prim.y + 60, title: 'DK-QUAKE Grid Editor',
    backgroundColor: '#11151c', webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  configWin.loadFile(path.join(__dirname, 'config.html'));
  configWin.on('closed', () => { configWin = null; });
}

app.whenReady().then(() => {
  try { powerSaveBlocker.start('prevent-display-sleep'); } catch (e) {}

  ipcMain.on('launch', (e, a) => runAction(a));
  ipcMain.on('volume', (e, v) => { if (robot) { try { if (v === 'mute') robot.keyTap('audio_mute'); else robot.keyTap(v > 0 ? 'audio_vol_up' : 'audio_vol_down'); } catch (er) {} } });
  ipcMain.on('switchGrid', (e, id) => { if (config.grids.some(g => g.id === id)) { config.activeGridId = id; saveConfig(); pushToPanel(); } });
  ipcMain.on('openConfig', () => openConfigWindow());
  ipcMain.handle('getConfig', () => config);
  ipcMain.on('saveConfigFromEditor', (e, newCfg) => { config = newCfg; saveConfig(); pushToPanel(); });
  ipcMain.handle('pickProgram', async () => {
    const r = await dialog.showOpenDialog(configWin, { properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe', 'lnk', 'bat', 'cmd', 'com'] }, { name: 'All Files', extensions: ['*'] }] });
    return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
  });

  placePanel();
  dev.on('touch', pts => { if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('touch', pts); });
  dev.on('knob', k => { if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('knob', k); }); // panel owns knob logic
  dev.on('connect', i => console.log('connect:', i.iface));
  dev.on('error', e => console.log('dev error:', e.message));
  dev.start();

  screen.on('display-added', () => { dev.screenOn(); setTimeout(placePanel, 800); });
  screen.on('display-removed', () => dev.screenOn());
  screen.on('display-metrics-changed', () => setTimeout(placePanel, 500));
});
app.on('window-all-closed', () => {});
