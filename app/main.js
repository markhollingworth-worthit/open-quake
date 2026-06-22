'use strict';
// DK-QUAKE launcher: multi-grid panel + PC config editor, on the open Aris68Connector driver.
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, powerSaveBlocker, ipcMain, shell, dialog, session, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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
const DEFAULT_SETTINGS = { launchMode: 'editor', micOnLaunch: false, knob: { rotateAction: 'volume' }, lighting: Object.assign({}, LED_DEFAULT) };
let firstRun = false;     // set by loadConfig when there was no prior config (fresh install)
let micState = false;     // current device mic state (LED follows it)
let lastRingEffect = LED_DEFAULT.effect; // remembered so the tray on/off toggle can restore the prior effect
let rotateRunning = false;               // screen-rotation runtime on/off (starts per settings on launch)
let rotTimer = null;
let sysserver = null;                    // SystemView/Music local server (lazy-required in whenReady)
let serverPort = 0;                      // the local server's ephemeral port (for music-page routing)
let config = loadConfig();
let panelWin = null, configWin = null, tray = null;
const dev = new Aris68Connector({ hid: HID });
function appSettings() {
  const s = Object.assign({}, DEFAULT_SETTINGS, config.settings || {});
  s.knob = Object.assign({}, DEFAULT_SETTINGS.knob, (config.settings || {}).knob || {});
  return s;
}

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
// QNAP is an optional companion service at a stable localhost URL. Inject a dashboard page so existing
// installs can select it without hand-entering the URL; deleting it remains sticky.
function ensureQnapPage() {
  if (!config.grids) config.grids = [];
  const existing = config.grids.find(g => g.id === 'qnap');
  if (existing) {
    if (existing.kind !== 'app' || existing.app !== 'qnap') {
      existing.kind = 'app';
      existing.app = 'qnap';
      existing.name = existing.name || 'QNAP NAS';
      existing.options = Object.assign({
        host: 'https://192.168.0.1:443',
        username: '',
        password: '',
        verifySsl: false,
        refreshSeconds: '15',
        debugErrors: false,
      }, existing.options || {});
      delete existing.url; delete existing.auth;
      saveConfig();
    }
    return;
  }
  if (config.qnapInjected) return;
  config.grids.push({
    id: 'qnap',
    name: 'QNAP NAS',
    kind: 'app',
    app: 'qnap',
    options: { host: 'https://192.168.0.1:443', username: '', password: '', verifySsl: false, refreshSeconds: '15', debugErrors: false },
    rotate: false,
  });
  config.qnapInjected = true;
  saveConfig();
}
// The Music controller is a built-in APP page (kind:'app', app:'music') that embeds a programmable
// 2x2 tile grid — edited in the editor exactly like Default/Media/Dev, its tiles launched via runAction.
// Ensure one exists on first run; respect deletion thereafter (musicInjected gate).
function ensureMusicPage() {
  if (!config.grids) config.grids = [];
  let g = config.grids.find(x => x.id === 'music');
  if (!g) {
    if (config.musicInjected) return;                      // user deleted it on purpose — leave it gone
    g = { id: 'music' }; config.grids.push(g); config.musicInjected = true;
  }
  g.name = g.name || 'Music';
  g.kind = 'app'; g.app = 'music';                         // (re)assert the app shape; migrates the old web-page form
  delete g.url; delete g.auth;
  if (typeof g.cols !== 'number') g.cols = 2;
  if (typeof g.rows !== 'number') g.rows = 2;
  if (!Array.isArray(g.tiles) || !g.tiles.length) {
    const def = loadApps().find(a => a.id === 'music');
    g.tiles = ((def && def.grid && def.grid.defaults) || []).map(t => Object.assign({}, t));
  }
  saveConfig();
}
// The Music app's embedded grid is served to the page (resolved icons) and its taps launched, both
// keyed to whichever music page is currently shown.
async function getMusicTiles() {
  const g = activeGrid();
  if (!(g && g.kind === 'app' && g.app === 'music')) return { cols: 2, rows: 2, tiles: [] };
  const resolved = await resolveGridIcons(Object.assign({}, g, { kind: 'grid' }));   // resolve icons (force the tile path)
  return { cols: g.cols || 2, rows: g.rows || 2, tiles: resolved.tiles || [] };
}
function onMusicLaunch(i) {
  const g = activeGrid();
  if (g && g.kind === 'app' && g.app === 'music' && g.tiles && g.tiles[i]) { runAction(g.tiles[i]); return true; }
  return false;
}
function getQnapOptions() {
  const g = activeGrid();
  return (g && g.kind === 'app' && g.app === 'qnap') ? (g.options || {}) : {};
}
function hostMatches(a, b) { try { return new URL(a).host === new URL(b).host; } catch (e) { return false; } }

function safeId(s) { return /^[a-z0-9][a-z0-9_-]*$/i.test(String(s || '')); }
function normalizeAppDef(def, baseDir) {
  if (!def || !safeId(def.id) || !def.name) return null;
  const out = Object.assign({}, def);
  if (baseDir) out.baseDir = baseDir;
  out.entry = out.entry || out.file || 'index.html';
  out.file = out.file || out.entry;
  if (!Array.isArray(out.options)) out.options = [];
  if (out.entry && (path.isAbsolute(out.entry) || out.entry.split(/[\\/]/).includes('..'))) return null;
  if (out.file && (path.isAbsolute(out.file) || out.file.split(/[\\/]/).includes('..'))) return null;
  return out;
}
function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.log('apps manifest load error:', file, e.message); return null; }
}
// Bundled local apps — legacy apps/apps.json plus drop-in folders with app.json/manifest.json.
function loadApps() {
  const apps = [];
  const seen = new Set();
  const add = (def, baseDir) => {
    const appDef = normalizeAppDef(def, baseDir);
    if (!appDef) return;
    if (seen.has(appDef.id)) { console.log('apps manifest duplicate id skipped:', appDef.id); return; }
    seen.add(appDef.id); apps.push(appDef);
  };

  const legacy = readJsonFile(path.join(APPS_DIR, 'apps.json'));
  if (Array.isArray(legacy)) legacy.forEach(def => add(def, null));

  let entries = [];
  try { entries = fs.readdirSync(APPS_DIR, { withFileTypes: true }); } catch (e) {}
  entries.filter(d => d.isDirectory()).forEach(d => {
    const baseDir = path.join(APPS_DIR, d.name);
    const manifest = ['app.json', 'manifest.json'].map(f => path.join(baseDir, f)).find(f => fs.existsSync(f));
    if (!manifest) return;
    const def = readJsonFile(manifest);
    if (def) add(def, baseDir);
  });

  return apps;
}
// Build the file: URL for an app page, encoding its options as a #hash (file:// drops a ?query).
function appPageUrl(page) {
  const def = loadApps().find(a => a.id === page.app);
  if (!def) return 'about:blank';
  if (def.served) {                                                          // served by the local server (live data, same-origin fetch, grid launch)
    const opts = page.options || {};                                         // pass options as a ?query (http keeps query strings; widgets like OWUI read them)
    const qs = (def.options || []).map(o => {
      if (o.serverOnly) return null;
      let v = (o.key in opts) ? opts[o.key] : o.default;
      if (v == null || v === '') return null;
      if (o.type === 'bool') v = v ? '1' : '0';
      return encodeURIComponent(o.key) + '=' + encodeURIComponent(v);
    }).filter(Boolean).join('&');
    const route = def.baseDir ? '/apps/' + encodeURIComponent(def.id) + '/' + encodeURI(def.entry || 'index.html') : '/' + def.id;
    return 'http://127.0.0.1:' + serverPort + route + (qs ? '?' + qs : '');
  }
  const file = path.join(def.baseDir || APPS_DIR, def.entry || def.file);
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
// Tell the local server which served page is on screen so it runs only that page's poller
// (SystemView metrics / Music now-playing) and idles the rest — no background polling while hidden.
function syncPollers(g) {
  if (!sysserver) return;
  const which = (g && g.id === 'sysview') ? 'sysview'
    : (g && g.kind === 'app' && g.app === 'music') ? 'music'
    : null;
  try { sysserver.setActivePage(which); } catch (e) {}
}
async function pushToPanel() {
  if (panelWin && !panelWin.isDestroyed()) {
    const g = activeGrid();
    syncPollers(g);                                                // run only the poller the shown page needs (before the webview reloads, so it primes)
    panelWin.webContents.send('grid', await resolveGridIcons(g));
    panelWin.webContents.send('gridList', { grids: gridList(), activeId: config.activeGridId });
    panelWin.webContents.send('settings', { knob: appSettings().knob });
    pushRotationState();
    if (!config.introShown) panelWin.webContents.send('intro');   // one-time "double-click the knob" overlay
  }
}

// Read a local image file into a data: URL so it renders in ANY panel page — including the http-served
// app pages (Music), which (unlike the native grid) cannot load file:// images.
function imageFileToDataUrl(p) {
  try {
    const buf = fs.readFileSync(p);
    const ext = path.extname(p).slice(1).toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : ext === 'ico' ? 'image/x-icon' : 'image/' + (ext || 'png');
    return 'data:' + mime + ';base64,' + buf.toString('base64');
  } catch (e) { return null; }
}

// Detect the real image format from the file's magic bytes. Servers sometimes mislabel content-type
// (e.g. clipartmax serves a JPEG as image/png), so we trust the bytes — the cached file needs the TRUE
// extension because imageFileToDataUrl derives the data-URL mime from the extension at render time.
function imageInfoFromBytes(buf) {
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return { mime: 'image/gif', ext: 'gif' };
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return { mime: 'image/webp', ext: 'webp' };
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4D) return { mime: 'image/bmp', ext: 'bmp' };
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return { mime: 'image/x-icon', ext: 'ico' };
  if (buf.slice(0, 512).toString('utf8').toLowerCase().includes('<svg')) return { mime: 'image/svg+xml', ext: 'svg' };
  return null;
}

// Download an image URL into the on-disk icon cache and return its local path. For URL tile icons:
// the file is then rendered through the SAME file->data:URL path as local images, so it works offline
// and in the http-served grids. Guardrails: http(s) only, real image bytes only, size-capped.
// Uses net.request (not net.fetch) so we can set a User-Agent — some hosts (e.g. Wikimedia) 403 without one.
const ICON_CACHE_DIR = path.join(USER_DIR, 'iconcache');
const ICON_MAX_BYTES = 3 * 1024 * 1024;
function fetchIconToCache(url) {
  url = (url || '').trim();
  return new Promise(resolve => {
    if (!/^https?:\/\//i.test(url)) return resolve({ ok: false, error: 'Only http(s) URLs are allowed.' });
    let req;
    try { req = net.request({ url, redirect: 'follow' }); }
    catch (e) { return resolve({ ok: false, error: 'That URL is not valid.' }); }
    req.setHeader('User-Agent', 'open-quake/' + app.getVersion() + ' (+https://github.com/TeeJS/open-quake)');
    req.setHeader('Accept', 'image/*');
    let done = false;
    const fail = msg => { if (done) return; done = true; try { req.abort(); } catch (e) {} resolve({ ok: false, error: msg }); };
    req.on('error', () => fail('Could not reach that URL.'));
    req.on('response', resp => {
      const status = resp.statusCode;
      if (status < 200 || status >= 300) { resp.resume(); return fail('Server returned HTTP ' + status + '.'); }
      const raw = resp.headers['content-type'];
      const ctype = String(Array.isArray(raw) ? raw[0] : (raw || '')).split(';')[0].trim().toLowerCase();
      // Reject obvious non-images on the header (avoid downloading an HTML page); allow image/*,
      // octet-stream, or a missing type — then confirm by sniffing the actual bytes below.
      if (ctype && !ctype.startsWith('image/') && ctype !== 'application/octet-stream') { resp.resume(); return fail('That URL is not an image (' + ctype + ').'); }
      const chunks = []; let total = 0;
      resp.on('data', d => { total += d.length; if (total > ICON_MAX_BYTES) return fail('Image is too large (over 3 MB).'); chunks.push(d); });
      resp.on('error', () => fail('Error reading the image.'));
      resp.on('end', () => {
        if (done) return; done = true;
        const buf = Buffer.concat(chunks);
        if (!buf.length) return resolve({ ok: false, error: 'The image was empty.' });
        const info = imageInfoFromBytes(buf);   // trust the real bytes over the (sometimes wrong) content-type header
        if (!info && !ctype.startsWith('image/')) return resolve({ ok: false, error: "That URL doesn't appear to be an image." });
        const mime = info ? info.mime : ctype;
        const ext = info ? info.ext : (ctype === 'image/jpeg' ? 'jpg' : ctype === 'image/svg+xml' ? 'svg' : (ctype === 'image/x-icon' || ctype === 'image/vnd.microsoft.icon') ? 'ico' : (ctype.slice(6).replace(/[^a-z0-9]/g, '') || 'png'));
        try { fs.mkdirSync(ICON_CACHE_DIR, { recursive: true }); } catch (e) {}
        const file = path.join(ICON_CACHE_DIR, crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + '.' + ext);
        try { fs.writeFileSync(file, buf); } catch (e) { return resolve({ ok: false, error: 'Could not save the icon to the cache.' }); }
        resolve({ ok: true, cachePath: file, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') });
      });
    });
    req.end();
  });
}

// On launch, delete cached URL-icon files that no tile references any more (orphaned when a tile's URL
// changed, the tile was deleted, or its icon type switched away from 'url'). Keyed by filename
// (sha1(url)), so a cache file shared by several tiles with the same URL is kept while ANY tile uses it.
function sweepIconCache() {
  let files;
  try { files = fs.readdirSync(ICON_CACHE_DIR); } catch (e) { return; }   // no cache dir yet -> nothing to sweep
  const used = new Set();
  for (const g of (config.grids || [])) for (const t of (g.tiles || [])) {
    if (t && t.iconType === 'url' && t.iconCache) used.add(path.basename(t.iconCache));
  }
  let removed = 0;
  for (const f of files) { if (!used.has(f)) { try { fs.unlinkSync(path.join(ICON_CACHE_DIR, f)); removed++; } catch (e) {} } }
  if (removed) console.log('icon cache: removed ' + removed + ' orphaned file(s)');
}
// Resolve app/image icons to a data: URL the panel renderer can draw (works in native + http pages).
async function resolveGridIcons(grid) {
  if (grid.kind === 'app') return { ...grid, kind: 'web', url: appPageUrl(grid) };   // render the local app in the webview
  if (grid.kind === 'web') return grid;   // dashboard page — no tiles to resolve
  const tiles = await Promise.all((grid.tiles || []).map(async t => {
    const out = { ...t };
    if (t.iconType === 'image' && t.iconImage) {
      out.iconSrc = imageFileToDataUrl(t.iconImage);
      if (!out.iconSrc) { try { out.iconSrc = pathToFileURL(t.iconImage).href; } catch (e) {} }   // fallback
    }
    else if (t.iconType === 'url' && t.iconCache) { out.iconSrc = imageFileToDataUrl(t.iconCache); }   // cached download -> data URL; null (gone) -> emoji fallback
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

// Media transport for the Music page — global media keys via robotjs (instant, in-process; Windows
// routes them to the active SMTC session, the same one nowplaying.js reports).
function mediaKey(cmd) {
  if (!robot) return false;
  const map = { playpause: 'audio_play', next: 'audio_next', prev: 'audio_prev', stop: 'audio_stop' };
  const k = map[cmd];
  if (!k) return false;
  try { robot.keyTap(k); return true; } catch (e) { return false; }
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
  try {
    sysserver = require('./sysserver');
    serverPort = await sysserver.start({ onMedia: mediaKey, onLaunch: onMusicLaunch, getMusicTiles, getQnapOptions, servedApps: loadApps().filter(a => a.served) });
    ensureSystemViewPage(serverPort); ensureMusicPage(); ensureQnapPage();
    console.log('SystemView + Music on http://127.0.0.1:' + serverPort);
  } catch (e) { console.log('local panel services failed to start:', e.message); }
  sweepIconCache();   // clean up orphaned URL-icon cache files left by prior sessions

  // Dashboard auth injection for the webview session. The active page's auth config drives it:
  //  - 'header'  -> add custom header(s) to requests to the dashboard host (bearer / Cloudflare Access / …)
  //  - 'basic'   -> answer HTTP Basic Auth challenges with the configured user/pass
  // ('ha' token injection is done renderer-side; 'none' does nothing.)
  const dashSession = session.fromPartition('persist:dashboards');
  dashSession.setPermissionRequestHandler((wc, permission, cb) => cb(true));   // local trusted panel: allow mic (push-to-talk) etc.
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
  ipcMain.handle('fetchIconUrl', (e, url) => fetchIconToCache(url));

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
