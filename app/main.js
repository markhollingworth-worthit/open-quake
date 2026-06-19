'use strict';
// DK-QUAKE launcher: multi-grid panel + PC config editor, on the open Aris68Connector driver.
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, powerSaveBlocker, ipcMain, shell, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { pathToFileURL } = require('url');
const HID = require('node-hid');
const Aris68Connector = require(path.join(__dirname, '..', 'src', 'Aris68Connector'));
let robot = null; try { robot = require('robotjs'); } catch (e) { console.log('robotjs unavailable (knob-volume off):', e.message); }

const USER_DIR = app.getPath('userData');
const CONFIG_PATH = path.join(USER_DIR, 'config.json');                  // writable — works inside a packaged app too
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'config.default.json'); // bundled (read-only)
const LEGACY_CONFIG_PATH = path.join(__dirname, 'config.json');          // pre-userData dev location, migrated once
const APPS_DIR = path.join(__dirname, '..', 'apps').replace('app.asar', 'app.asar.unpacked'); // unpacked when packaged
const LED_DEFAULT = { effect: 1, brightness: 200, speed: 128, hue: 128, sat: 255 }; // ring lighting fallback (effect 1 = Solid Color)
const DEFAULT_SETTINGS = { launchMode: 'editor', micOnLaunch: false, lighting: Object.assign({}, LED_DEFAULT) };
let firstRun = false;     // set by loadConfig when there was no prior config (fresh install)
let micState = false;     // current device mic state (LED follows it)
let lastRingEffect = LED_DEFAULT.effect; // remembered so the tray on/off toggle can restore the prior effect
let rotateRunning = false;               // screen-rotation runtime on/off (starts per settings on launch)
let rotTimer = null;
let sysserver = null;                    // SystemView local metrics server (lazy-required in whenReady)
let config = loadConfig();
let panelWin = null, configWin = null, tray = null;
const dev = new Aris68Connector({ hid: HID });
function appSettings() { return Object.assign({}, DEFAULT_SETTINGS, config.settings || {}); }

// User config lives in the OS user-data dir (writable even inside a packaged app). On first run it's
// seeded from a previous dev config (app/config.json) if present, otherwise the bundled default.
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      firstRun = true;
      fs.mkdirSync(USER_DIR, { recursive: true });
      const seed = fs.existsSync(LEGACY_CONFIG_PATH) ? LEGACY_CONFIG_PATH : DEFAULT_CONFIG_PATH;
      if (fs.existsSync(seed)) fs.copyFileSync(seed, CONFIG_PATH);
    }
    return migrateConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch (e) { console.log('config load error:', e.message); return { activeGridId: null, grids: [] }; }
}
// Normalize dashboard auth: fold the old per-page `haToken` into the typed `auth` object.
function migrateConfig(c) {
  (c.grids || []).forEach(g => {
    if (g.kind === 'web') {
      if (!g.auth) g.auth = g.haToken ? { type: 'ha', token: g.haToken } : { type: 'none' };
      delete g.haToken;
    }
  });
  return c;
}
// SystemView is a built-in localhost dashboard. Ensure the page exists and its url points at the
// current (ephemeral) server port. Respect deletion: once injected, if the user removes it we don't
// re-add it (tracked via config.sysviewInjected) — so deleting it sticks.
function ensureSystemViewPage(port) {
  const url = `http://127.0.0.1:${port}/`;
  if (!config.grids) config.grids = [];
  const existing = config.grids.find(g => g.id === 'sysview');
  if (existing) {                                          // keep the user's name/rotate; just refresh the (dynamic) port
    if (existing.url !== url) { existing.url = url; saveConfig(); if (config.activeGridId === 'sysview') pushToPanel(); }
    return;
  }
  if (config.sysviewInjected) return;                      // user deleted it on purpose — leave it gone
  config.grids.push({ id: 'sysview', name: 'System Monitor', kind: 'web', url, auth: { type: 'none' }, rotate: false });
  config.sysviewInjected = true;
  saveConfig();
}
function hostMatches(a, b) { try { return new URL(a).host === new URL(b).host; } catch (e) { return false; } }

// Bundled local apps (apps/apps.json) — name, file, and an options schema the editor renders.
function loadApps() {
  try { return JSON.parse(fs.readFileSync(path.join(APPS_DIR, 'apps.json'), 'utf8')); }
  catch (e) { console.log('apps manifest load error:', e.message); return []; }
}
// Build the file: URL for an app page, encoding its options as a #hash (file:// drops a ?query).
function appPageUrl(page) {
  const def = loadApps().find(a => a.id === page.app);
  if (!def) return 'about:blank';
  const file = path.join(APPS_DIR, def.file);
  const opts = page.options || {};
  const hash = (def.options || []).map(o => {
    let v = (o.key in opts) ? opts[o.key] : o.default;
    if (o.type === 'bool') v = v ? '1' : '0';
    return encodeURIComponent(o.key) + '=' + encodeURIComponent(v);
  }).join('&');
  return pathToFileURL(file).href + (hash ? '#' + hash : '');
}
function saveConfig() { try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); } catch (e) { console.log('config save error:', e.message); } }
function activeGrid() { return config.grids.find(g => g.id === config.activeGridId) || config.grids[0] || { cols: 8, rows: 2, tiles: [] }; }
function gridList() { return config.grids.map(g => ({ id: g.id, name: g.name })); }
async function pushToPanel() {
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.webContents.send('grid', await resolveGridIcons(activeGrid()));
    panelWin.webContents.send('gridList', { grids: gridList(), activeId: config.activeGridId });
    pushRotationState();
    if (!config.introShown) panelWin.webContents.send('intro');   // one-time "double-click the knob" overlay
  }
}

// Resolve app/image icons to something the panel renderer can draw (data: URL or file: URL).
async function resolveGridIcons(grid) {
  if (grid.kind === 'app') return { ...grid, kind: 'web', url: appPageUrl(grid) };   // render the local app in the webview
  if (grid.kind === 'web') return grid;   // dashboard page — no tiles to resolve
  const tiles = await Promise.all((grid.tiles || []).map(async t => {
    const out = { ...t };
    if (t.iconType === 'image' && t.iconImage) { try { out.iconSrc = pathToFileURL(t.iconImage).href; } catch (e) {} }
    else if (t.iconType === 'app') { const d = await getAppIconDataUrl(t.value); if (d) out.iconSrc = d; }
    return out;
  }));
  return { ...grid, tiles };
}

// Extract a program's own icon as a data: URL (best-effort; null if it can't be resolved).
async function getAppIconDataUrl(value) {
  try {
    const p = await resolveAppPath(value);
    if (!p) return null;
    const img = await app.getFileIcon(p, { size: 'large' });
    return (!img || img.isEmpty()) ? null : img.toDataURL();
  } catch (e) { return null; }
}

// Turn an app value into a real file path: full paths used as-is; bare names resolved via `where`.
function resolveAppPath(value) {
  return new Promise(resolve => {
    if (!value) return resolve(null);
    if (/[\\/]/.test(value)) return resolve(fs.existsSync(value) ? value : null);
    exec(`where "${value}"`, { windowsHide: true }, (err, stdout) => {
      const first = (stdout || '').split(/\r?\n/).map(s => s.trim()).find(Boolean);
      resolve(first && fs.existsSync(first) ? first : null);
    });
  });
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
      case 'page': gotoGrid(a.value, true); if (rotateRunning) scheduleRotation(); break;   // switch the panel to another page
      case 'system':
        if (a.value === 'lock') exec('rundll32.exe user32.dll,LockWorkStation');
        else if (a.value === 'mic') toggleMic();
        break;
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
      webPreferences: { nodeIntegration: true, contextIsolation: false, webviewTag: true },
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
    width: 1180, height: 760, x: prim.x + 80, y: prim.y + 60, title: 'open-quake Editor',
    backgroundColor: '#11151c', webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  configWin.loadFile(path.join(__dirname, 'config.html'));
  configWin.on('closed', () => { configWin = null; });
  configWin.webContents.on('context-menu', (e, props) => {
    const sel = props.selectionText && props.selectionText.trim().length > 0;
    const editable = props.isEditable;
    const menu = Menu.buildFromTemplate([
      { role: 'cut', enabled: editable && sel },
      { role: 'copy', enabled: sel },
      { role: 'paste', enabled: editable },
      { type: 'separator' },
      { role: 'selectAll', enabled: editable || sel },
    ]);
    menu.popup({ window: configWin });
  });
}

// ---- device settings (knob RGB ring, mic) ----
function lighting() { return Object.assign({}, LED_DEFAULT, (config.settings || {}).lighting || {}); }
function applyKnobSettings() {
  const L = lighting();
  try { dev.setKnobLed(true); } catch (e) {}              // keep the ring from idle-sleeping (effect 0 = visually off)
  try { dev.setLedEffect(L.effect & 0xFF); } catch (e) {}
  try { dev.setLedBrightness(L.brightness & 0xFF); } catch (e) {}
  try { dev.setLedSpeed(L.speed & 0xFF); } catch (e) {}
  try { dev.setLedColor(L.hue & 0xFF, L.sat & 0xFF); } catch (e) {}
  if (L.effect) lastRingEffect = L.effect;
}
function applyMic(on) { try { dev.setMic(on); } catch (e) {} micState = !!on; refreshTray(); }
function toggleMic() { applyMic(!micState); }
function toggleKnobRing() {
  if (!config.settings) config.settings = {};
  const L = config.settings.lighting = lighting();
  if (L.effect === 0) L.effect = lastRingEffect || 1;     // turn back on -> restore the last effect
  else { lastRingEffect = L.effect; L.effect = 0; }        // turn off -> All Off
  saveConfig(); applyKnobSettings(); refreshTray();
}

// ---- screen rotation (auto-cycle pages) ----
function rotationCfg() {
  const r = (config.settings && config.settings.rotation) || {};
  return {
    enabled: !!r.enabled,
    interval: Math.max(5, Math.min(3600, parseInt(r.interval, 10) || 30)),
    cats: Object.assign({ grids: false, dashboards: false, apps: false }, r.cats || {}),
  };
}
function pageCategory(g) { return g.kind === 'web' ? 'dashboards' : g.kind === 'app' ? 'apps' : 'grids'; }
function rotationList() { const c = rotationCfg(); return config.grids.filter(g => g.rotate && c.cats[pageCategory(g)]); }
function gotoGrid(id, persist) {
  if (!config.grids.some(g => g.id === id)) return;
  config.activeGridId = id; if (persist) saveConfig(); pushToPanel();
}
function rotateTick() {
  const ids = rotationList().map(g => g.id);
  if (ids.length < 2) return;                                  // nothing to cycle through
  gotoGrid(ids[(ids.indexOf(config.activeGridId) + 1) % ids.length], false);   // active not in list (-1) -> first
}
function scheduleRotation() {
  if (rotTimer) { clearTimeout(rotTimer); rotTimer = null; }
  if (!rotateRunning) return;
  rotTimer = setTimeout(() => { rotateTick(); scheduleRotation(); }, rotationCfg().interval * 1000);
}
function pushRotationState() {
  if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('rotation', { enabled: rotationCfg().enabled, running: rotateRunning });
}
function setRotation(on) { rotateRunning = !!on && rotationCfg().enabled; scheduleRotation(); refreshTray(); pushRotationState(); }
function toggleRotation() { setRotation(!rotateRunning); }
// Re-evaluate after a settings change: a fresh off->on starts it, off stops it, on->on keeps the runtime state
// (so a manual pause survives an unrelated save). interval/page changes are picked up by the (re)schedule.
function applyRotationSettings(wasEnabled) {
  const enabled = rotationCfg().enabled;
  if (!enabled) rotateRunning = false;
  else if (!wasEnabled) rotateRunning = true;
  scheduleRotation(); refreshTray(); pushRotationState();
}

// Tray icon — the app's desktop presence (the panel window deliberately skips the taskbar).
function trayMenu() {
  const ringOn = lighting().effect !== 0;
  const items = [
    { label: 'open-quake', enabled: false },
    { type: 'separator' },
    { label: 'Open editor', click: () => openConfigWindow() },
    { label: micState ? 'Mic: on — click to disable' : 'Mic: off — click to enable', click: () => toggleMic() },
    { label: ringOn ? 'Knob ring: on — click to turn off' : 'Knob ring: off — click to turn on', click: () => toggleKnobRing() },
  ];
  if (rotationCfg().enabled) items.push({ label: rotateRunning ? 'Auto-rotate: on — click to pause' : 'Auto-rotate: off — click to start', click: () => toggleRotation() });
  items.push(
    { label: 'Re-place panel on device', click: () => { try { dev.screenOn(); } catch (e) {} placePanel(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { try { dev.stop(); } catch (e) {} app.quit(); } },
  );
  return Menu.buildFromTemplate(items);
}
function refreshTray() { if (tray) tray.setContextMenu(trayMenu()); }
function createTray() {
  if (tray) return;
  let img;
  try { img = nativeImage.createFromBuffer(fs.readFileSync(path.join(__dirname, 'icon.png'))); } catch (e) { img = nativeImage.createEmpty(); }
  tray = new Tray(img);
  tray.setToolTip('open-quake');
  refreshTray();
  tray.on('click', () => openConfigWindow());
}

// Single-instance lock — a 2nd launch must not spawn a rival panel window (it fights the running
// one over the device display → a white panel). Bail out; the running instance re-homes its panel.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);                                           // a copy already runs — force-exit now; this instance inits nothing
} else {
app.on('second-instance', () => {
  try { dev.screenOn(); } catch (e) {}
  placePanel();
  if (configWin && !configWin.isDestroyed()) { configWin.show(); configWin.focus(); }
  else openConfigWindow();
});

app.whenReady().then(async () => {
  try { powerSaveBlocker.start('prevent-display-sleep'); } catch (e) {}
  createTray();
  // SystemView: live local metrics server on 127.0.0.1 (OS-assigned port) + ensure the dashboard page.
  // Lazy-required so a metrics/load failure can never crash the rest of the app.
  try { sysserver = require('./sysserver'); const port = await sysserver.start(); ensureSystemViewPage(port); console.log('SystemView on http://127.0.0.1:' + port); }
  catch (e) { console.log('SystemView failed to start:', e.message); }

  // Dashboard auth injection for the webview session. The active page's auth config drives it:
  //  - 'header'  -> add custom header(s) to requests to the dashboard host (bearer / Cloudflare Access / …)
  //  - 'basic'   -> answer HTTP Basic Auth challenges with the configured user/pass
  // ('ha' token injection is done renderer-side; 'none' does nothing.)
  const dashSession = session.fromPartition('persist:dashboards');
  dashSession.webRequest.onBeforeSendHeaders((details, cb) => {
    const g = activeGrid();
    if (g && g.kind === 'web' && g.auth && g.auth.type === 'header' && hostMatches(g.url, details.url)) {
      const h = details.requestHeaders;
      (g.auth.headers || []).forEach(x => { if (x.name) h[x.name] = x.value; });
      return cb({ requestHeaders: h });
    }
    cb({});
  });
  app.on('login', (event, webContents, request, authInfo, callback) => {
    if (authInfo.isProxy) return;
    const g = activeGrid();
    if (g && g.kind === 'web' && g.auth && g.auth.type === 'basic' && hostMatches(g.url, request.url)) {
      event.preventDefault();
      callback(g.auth.user || '', g.auth.pass || '');
    }
  });

  ipcMain.on('launch', (e, a) => runAction(a));
  ipcMain.on('volume', (e, v) => { if (robot) { try { if (v === 'mute') robot.keyTap('audio_mute'); else robot.keyTap(v > 0 ? 'audio_vol_up' : 'audio_vol_down'); } catch (er) {} } });
  ipcMain.on('switchGrid', (e, id) => { gotoGrid(id, true); if (rotateRunning) scheduleRotation(); });   // a manual pick resets the rotation timer
  ipcMain.on('toggleRotation', () => toggleRotation());
  ipcMain.on('openConfig', () => openConfigWindow());
  ipcMain.on('introDone', () => { config.introShown = true; saveConfig(); });   // remember the intro was dismissed
  ipcMain.on('openExternal', (e, url) => { try { if (typeof url === 'string' && /^https?:/i.test(url)) shell.openExternal(url); } catch (er) {} });
  ipcMain.handle('getConfig', () => config);
  ipcMain.handle('getApps', () => loadApps());
  ipcMain.on('saveConfigFromEditor', (e, newCfg) => {
    const active = config.activeGridId;                          // the knob owns the live page — editor edits never change it
    const wasRot = rotationCfg().enabled;                        // detect a fresh off->on to auto-start (else keep the runtime pause)
    config = newCfg;
    if (config.grids.some(g => g.id === active)) config.activeGridId = active;
    else if (!config.grids.some(g => g.id === config.activeGridId)) config.activeGridId = (config.grids[0] || {}).id || null;
    saveConfig(); pushToPanel(); applyKnobSettings(); refreshTray(); applyRotationSettings(wasRot);
  });
  ipcMain.handle('pickProgram', async () => {
    const r = await dialog.showOpenDialog(configWin, { properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe', 'lnk', 'bat', 'cmd', 'com'] }, { name: 'All Files', extensions: ['*'] }] });
    return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
  });
  ipcMain.handle('pickImage', async () => {
    const r = await dialog.showOpenDialog(configWin, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'] }, { name: 'All Files', extensions: ['*'] }] });
    return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
  });
  ipcMain.handle('getAppIcon', (e, value) => getAppIconDataUrl(value));

  // Knob RGB ring (QMK VIA). The editor's Settings page reads the device's current lighting, then
  // applies each change live; "Save to device" persists it to the device's own flash.
  ipcMain.handle('getLighting', async () => {
    let cur = null;
    try { cur = await dev.getLighting(); } catch (e) {}
    return Object.assign({}, lighting(), cur && Object.keys(cur).length ? cur : {});
  });
  ipcMain.on('setLighting', (e, L) => {
    if (!L) return;
    if (!config.settings) config.settings = {};
    config.settings.lighting = Object.assign({}, lighting(), L);
    if (config.settings.lighting.effect) lastRingEffect = config.settings.lighting.effect;
    saveConfig();
    try {
      if (L.effect != null) dev.setLedEffect(L.effect & 0xFF);
      if (L.brightness != null) dev.setLedBrightness(L.brightness & 0xFF);
      if (L.speed != null) dev.setLedSpeed(L.speed & 0xFF);
      if (L.hue != null && L.sat != null) dev.setLedColor(L.hue & 0xFF, L.sat & 0xFF);
    } catch (er) {}
    refreshTray();
  });
  ipcMain.handle('saveLightingToDevice', () => { try { return dev.saveLighting(); } catch (e) { return false; } });

  placePanel();
  if (rotationCfg().enabled) setRotation(true);          // auto-start cycling on launch when enabled
  const ls = appSettings();
  if (firstRun || ls.launchMode === 'editor') openConfigWindow();
  else if (ls.launchMode === 'minimized') { openConfigWindow(); if (configWin && !configWin.isDestroyed()) configWin.minimize(); }
  // 'tray' -> stay quiet (tray + panel only)

  dev.on('touch', pts => { if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('touch', pts); });
  dev.on('knob', k => { if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('knob', k); }); // panel owns knob logic
  dev.on('connect', async i => {
    console.log('connect:', i.iface);
    if (i.iface !== 'control') return;
    // First run: seed lighting from the device so we never change the ring unasked; otherwise the app's config wins.
    if (!config.settings || !config.settings.lighting) {
      try {
        const cur = await dev.getLighting();
        if (cur && Object.keys(cur).length) { if (!config.settings) config.settings = {}; config.settings.lighting = Object.assign({}, LED_DEFAULT, cur); saveConfig(); }
      } catch (e) {}
    }
    applyKnobSettings();
    applyMic(appSettings().micOnLaunch);
    // The mic indicator LED only latches once the panel is fully awake. At connect the device is still
    // mid screen-on activation (screenOn fires at 0/300/800/1500ms), so this first setMic toggles the
    // audio but the LED is dropped. Re-assert after activation settles — screenOn then setMic — which
    // mirrors what a display re-wake does and forces the LED to follow the mic state.
    setTimeout(() => { try { dev.screenOn(); } catch (e) {} applyMic(micState); console.log('mic LED re-assert:', micState); }, 2000);
  });
  dev.on('error', e => console.log('dev error:', e.message));
  dev.start();

  screen.on('display-added', () => { dev.screenOn(); setTimeout(placePanel, 800); });
  screen.on('display-removed', () => dev.screenOn());
  screen.on('display-metrics-changed', () => setTimeout(placePanel, 500));
});
}
app.on('window-all-closed', () => {});
app.on('before-quit', () => { try { if (sysserver) sysserver.stop(); } catch (e) {} });   // stop metrics timers + close the server
