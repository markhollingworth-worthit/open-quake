'use strict';
// DK-QUAKE launcher: multi-grid panel + PC config editor, on the open Aris68Connector driver.
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, powerSaveBlocker, ipcMain, shell, dialog, session, net, safeStorage, clipboard, globalShortcut, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { exec, execFile, spawn } = require('child_process');
const { pathToFileURL } = require('url');
const HID = require('node-hid');
const Aris68Connector = require(path.join(__dirname, '..', 'src', 'Aris68Connector'));
const http = require('http');
const actionRunner = require('./actionRunner');
const { createMediaKeys } = require('./mediaKeys');
const { createSecretStore } = require('./secretStore');
const nowplaying = require('./nowplaying');   // same singleton sysserver polls — read its snapshot to target transport
const haschedule = require('./haschedule');   // HA Schedule dev app — fed HA creds from .env, polled while shown

const USER_DIR = app.getPath('userData');
const CONFIG_PATH = path.join(USER_DIR, 'config.json');                  // writable — works inside a packaged app too
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'config.default.json'); // bundled (read-only)
const LEGACY_CONFIG_PATH = path.join(__dirname, 'config.json');          // pre-userData dev location, migrated once
const APPS_DIR = path.join(__dirname, '..', 'apps').replace('app.asar', 'app.asar.unpacked'); // unpacked when packaged
const SMTC_CTL_EXE = path.join(__dirname, 'native', 'smtc-control.exe').replace('app.asar', 'app.asar.unpacked'); // SMTC transport helper (Windows)
const LED_DEFAULT = { effect: 1, brightness: 200, speed: 128, hue: 128, sat: 255 }; // ring lighting fallback (effect 1 = Solid Color)
const THEME_DEFAULT = { appearance: 'system', accent: '#7CFFB2', presets: ['#7CFFB2', '#38B6FF', '#FF4040', '#FFB000'] };
const DEFAULT_SETTINGS = { launchMode: 'editor', micOnLaunch: false, lighting: Object.assign({}, LED_DEFAULT), theme: Object.assign({}, THEME_DEFAULT) };
const actionDeps = { fs, shell, exec, execFile, spawn, platform: process.platform, log: message => console.log(message) };
const mediaKeys = createMediaKeys({ log: message => console.log(message) });
let firstRun = false;     // set by loadConfig when there was no prior config (fresh install)
let micState = false;     // current device mic state (LED follows it)
let lastRingEffect = LED_DEFAULT.effect; // remembered so the tray on/off toggle can restore the prior effect
let rotateRunning = false;               // screen-rotation runtime on/off (starts per settings on launch)
let rotTimer = null;
let monitorMode = false;                 // monitor mode: panel UI hidden so the device shows the Windows desktop
let touchDown = false, touchIdle = null; // monitor-mode touch -> OS mouse button state
let sysserver = null;                    // SystemView/Music local server (lazy-required in whenReady)
let serverPort = 0;                      // the local server's ephemeral port (for music-page routing)
let config = loadConfig();
let panelWin = null, configWin = null, tray = null;
let dashSession = null, cookieFlushT = null;   // dashboard webview session + a debounced cookie-store flush
const dev = new Aris68Connector({ hid: HID });
function appSettings() { return Object.assign({}, DEFAULT_SETTINGS, config.settings || {}); }
// ---- theme (global light/dark + accent, with per-card overrides) ----
function themeGlobal() { return Object.assign({}, THEME_DEFAULT, (config.settings || {}).theme || {}); }
function isValidHex(h) { return typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h); }
// Effective theme for a page: per-card override -> global -> system. Returns { dark, accent }.
function effectiveTheme(g) {
  const t = themeGlobal();
  let appearance = (g && g.appearance && g.appearance !== 'inherit') ? g.appearance : t.appearance;
  if (appearance !== 'light' && appearance !== 'dark') appearance = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  const accent = (g && isValidHex(g.accent)) ? g.accent : (isValidHex(t.accent) ? t.accent : THEME_DEFAULT.accent);
  return { dark: appearance === 'dark', accent };
}
// Apply the global theme: drive the OS theme source (also sets prefers-color-scheme for web dashboards),
// repaint the panel chrome for the active page, and follow the accent on the knob ring (unless overridden).
function applyTheme() {
  const a = themeGlobal().appearance;
  try { nativeTheme.themeSource = (a === 'light' || a === 'dark') ? a : 'system'; } catch (e) {}
  pushTheme();
  applyKnobSettings();
}
// Theme payload: per-card light/dark + accent for the active page, PLUS the global light/dark so the
// panel's page-menu/intro overlays can stay in the user's chosen mode even on a per-card-overridden page.
function themePayload() { return Object.assign({}, effectiveTheme(activeGrid()), { globalDark: effectiveTheme(null).dark }); }
function pushTheme() {
  if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('theme', themePayload());
}
// hex -> {hue,sat} (0..255), value fixed full — matches the editor/DK-Suite ring conversion.
function hexToHsv255(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); if (!m) return null;
  const r = parseInt(m[1], 16) / 255, gg = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn; let h = 0;
  if (d) { if (mx === r) h = ((gg - b) / d) % 6; else if (mx === gg) h = (b - r) / d + 2; else h = (r - gg) / d + 4; h *= 60; if (h < 0) h += 360; }
  return { hue: Math.round((h / 360) * 255), sat: Math.round((mx ? d / mx : 0) * 255) };
}
// IPC hardening: only accept a channel from the window that legitimately owns it. The panel hosts a
// <webview> of arbitrary dashboard pages (its own separate webContents), so comparing against
// panelWin.webContents rejects any guest page — or stray sender — that reaches the preload bridge.
function isFrom(e, win) { return !!(win && !win.isDestroyed() && e.sender === win.webContents); }

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
function hostMatches(a, b) { try { return new URL(a).host === new URL(b).host; } catch (e) { return false; } }
function allowedExternalUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
  } catch (e) {
    return null;
  }
}
function openExternalUrl(value) {
  const url = allowedExternalUrl(value);
  if (!url) return false;
  shell.openExternal(url).catch(e => console.log('openExternal error:', e.message));
  return true;
}
function trustedMediaOrigins() {
  const raw = appSettings().trustedMediaOrigins;
  if (!Array.isArray(raw)) return [];
  return raw.map(origin => {
    try { return new URL(origin).origin; } catch (e) { return null; }
  }).filter(Boolean);
}
function isLocalChatUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) === serverPort && url.pathname === '/chat';
  } catch (e) {
    return false;
  }
}
function isTrustedMediaRequest(wc, details) {
  const requestingUrl = (details && (details.requestingUrl || details.securityOrigin)) || (wc && wc.getURL && wc.getURL()) || '';
  if (details && Array.isArray(details.mediaTypes) && !details.mediaTypes.includes('audio')) return false;
  if (isLocalChatUrl(requestingUrl)) return true;
  try { return trustedMediaOrigins().includes(new URL(requestingUrl).origin); }
  catch (e) { return false; }
}
function handleDashboardPermissionRequest(wc, permission, cb, details) {
  if (permission === 'media' && isTrustedMediaRequest(wc, details)) return cb(true);
  return cb(false);
}

const SAFE_APP_ID = /^[a-z0-9][a-z0-9_-]*$/;
const appManifestWarnings = new Set();
function warnAppManifest(key, message) {
  if (appManifestWarnings.has(key)) return;
  appManifestWarnings.add(key);
  console.log(message);
}
function safeAppEntry(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const rel = value.trim().replace(/\\/g, '/');
  if (rel.includes('..') || rel.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rel) || path.isAbsolute(rel)) return null;
  return rel;
}
function appEntryUrlPath(entry) { return String(entry || '').split('/').map(encodeURIComponent).join('/'); }
function readLegacyApps() {
  try {
    const apps = JSON.parse(fs.readFileSync(path.join(APPS_DIR, 'apps.json'), 'utf8'));
    return Array.isArray(apps) ? apps : [];
  } catch (e) { console.log('apps manifest load error:', e.message); return []; }
}
function readFolderAppManifest(appDir) {
  for (const name of ['app.json', 'manifest.json']) {
    const manifestPath = path.join(appDir, name);
    try {
      if (fs.existsSync(manifestPath)) return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      warnAppManifest('parse:' + manifestPath, 'app manifest load error: ' + manifestPath + ' - ' + e.message);
      return null;
    }
  }
  return null;
}
function appCatalog() {
  const apps = readLegacyApps();
  const ids = new Set(apps.map(a => a && a.id).filter(Boolean));
  const servedApps = {};
  let entries = [];
  try { entries = fs.readdirSync(APPS_DIR, { withFileTypes: true }); }
  catch (e) { return { apps, servedApps }; }
  entries.filter(d => d.isDirectory()).forEach(d => {
    const appDir = path.join(APPS_DIR, d.name);
    const manifest = readFolderAppManifest(appDir);
    if (!manifest) return;
    const id = typeof manifest.id === 'string' ? manifest.id.trim() : '';
    if (!SAFE_APP_ID.test(id)) {
      warnAppManifest('id:' + appDir, 'skipping app folder with invalid id: ' + appDir);
      return;
    }
    const entry = safeAppEntry(manifest.entry || manifest.file);
    if (!entry) {
      warnAppManifest('entry:' + appDir, 'skipping app folder with invalid entry: ' + id);
      return;
    }
    if (ids.has(id)) {
      warnAppManifest('dup:' + id, 'skipping duplicate app id: ' + id);
      return;
    }
    const def = Object.assign({}, manifest, {
      id,
      name: manifest.name || id,
      file: entry,
      entry,
      served: !!manifest.served,
      options: Array.isArray(manifest.options) ? manifest.options : [],
      _folder: true,
      _dir: appDir,
    });
    apps.push(def);
    ids.add(id);
    if (def.served) servedApps[id] = { root: appDir, proxy: manifest.proxy || null };
  });
  return { apps, servedApps };
}
// Bundled local apps (apps/apps.json) plus drop-in app folders under apps/<id>/.
function loadApps() { return appCatalog().apps; }
function discoveredServedApps() { return appCatalog().servedApps; }
// Secret-at-rest store: encrypts the secret-typed config fields (dashboard tokens / Basic passwords /
// custom header values / app secret options) in config.json via Electron safeStorage. The in-memory
// `config` stays plaintext; encryption happens only at the disk boundary (saveConfig). safeStorage
// needs app-ready, so decryptConfig runs as the first thing in whenReady, not at module load.
const secretStore = createSecretStore({ safeStorage, loadApps, log: m => console.log(m) });

// Build the file: URL for an app page, encoding its options as a #hash (file:// drops a ?query).
function appOptionQuery(def, opts, include) {
  return (def.options || []).map(o => {
    if (include && !include(o)) return null;
    let v = (o.key in opts) ? opts[o.key] : o.default;
    if (v == null || v === '') return null;
    if (o.type === 'bool') v = v ? '1' : '0';
    return encodeURIComponent(o.key) + '=' + encodeURIComponent(v);
  }).filter(Boolean).join('&');
}
// Theme params every app page receives (effective light/dark + accent for that card).
function themeParams(page) {
  const t = effectiveTheme(page);
  return '_dark=' + (t.dark ? '1' : '0') + '&_accent=' + encodeURIComponent(t.accent);
}
function appPageUrl(page) {
  const def = loadApps().find(a => a.id === page.app);
  if (!def) return 'about:blank';
  if (def.served) {                                                          // served by the local server (live data, same-origin fetch, grid launch)
    const opts = page.options || {};                                         // non-secret options only; secrets are served by /app-config
    const qs = [appOptionQuery(def, opts, o => o.type !== 'secret'), themeParams(page)].filter(Boolean).join('&');
    if (def._folder) return 'http://127.0.0.1:' + serverPort + '/apps/' + encodeURIComponent(def.id) + '/' + appEntryUrlPath(def.entry || def.file) + (qs ? '?' + qs : '');
    return 'http://127.0.0.1:' + serverPort + '/' + def.id + (qs ? '?' + qs : '');
  }
  const file = def._folder ? path.join(def._dir, def.entry || def.file) : path.join(APPS_DIR, def.file);
  const opts = page.options || {};
  const hash = [appOptionQuery(def, opts, o => o.type !== 'secret'), themeParams(page)].filter(Boolean).join('&');
  return pathToFileURL(file).href + (hash ? '#' + hash : '');
}
function activeServedAppConfig(appId) {
  const g = activeGrid();
  if (!(g && g.kind === 'app' && g.app === appId)) return null;
  const def = loadApps().find(a => a.id === appId);
  if (!(def && def.served)) return null;
  const opts = g.options || {};
  const options = {};
  (def.options || []).forEach(o => {
    let v = (o.key in opts) ? opts[o.key] : o.default;
    if (o.type === 'bool') v = !!v;
    options[o.key] = v == null ? '' : v;
  });
  return { app: appId, options };
}
// Persist config with secret fields encrypted at rest. encryptConfig clones, so the in-memory
// `config` keeps its plaintext secrets — consumers (renderer HA token, Basic/header auth, served
// app config) read the live plaintext. When safeStorage is unavailable, encryptValue logs nothing
// itself but falls back to plaintext on disk (see decrypt passthrough on the next load).
function saveConfig() { try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(secretStore.encryptConfig(config), null, 2)); } catch (e) { console.log('config save error:', e.message); } }
function activeGrid() { return config.grids.find(g => g.id === config.activeGridId) || config.grids[0] || { cols: 8, rows: 2, tiles: [] }; }
function gridList() { return config.grids.map(g => ({ id: g.id, name: g.name })); }
// Tell the local server which served page is on screen so it runs only that page's poller
// (SystemView metrics / Music now-playing) and idles the rest — no background polling while hidden.
function syncPollers(g) {
  if (!sysserver) return;
  const which = monitorMode ? null                                  // panel hidden (monitor mode) -> idle every page poller
    : (g && g.id === 'sysview') ? 'sysview'
    : (g && g.kind === 'app' && g.app === 'music') ? 'music'
    : null;
  try { sysserver.setActivePage(which); } catch (e) {}
  // HA Schedule dev app: poll HA only while it's shown, at the page's chosen interval (default 10 min).
  try {
    if (!monitorMode && g && g.kind === 'app' && g.app === 'haschedule') haschedule.start((parseInt((g.options || {}).interval, 10) || 600) * 1000);
    else haschedule.stop();
  } catch (e) {}
}
// Minimal .env reader (KEY=VALUE lines) for dev-app secrets like the HA token — kept out of config/git.
function loadEnv() {
  const out = {};
  for (const p of [path.join(process.cwd(), '.env'), path.join(__dirname, '..', '.env')]) {
    try {
      fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(line => {
        const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
      });
    } catch (e) {}
  }
  return out;
}
async function pushToPanel() {
  if (panelWin && !panelWin.isDestroyed()) {
    const g = activeGrid();
    syncPollers(g);                                                // run only the poller the shown page needs (before the webview reloads, so it primes)
    panelWin.webContents.send('theme', themePayload());            // light/dark + accent for this page (chrome paints before the grid renders)
    panelWin.webContents.send('grid', await resolveGridIcons(g));
    panelWin.webContents.send('gridList', { grids: gridList(), activeId: config.activeGridId });
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
async function resolveTiles(tiles) {
  return Promise.all((tiles || []).map(async t => {
    const out = { ...t };
    if (t.iconType === 'image' && t.iconImage) {
      out.iconSrc = imageFileToDataUrl(t.iconImage);
      if (!out.iconSrc) { try { out.iconSrc = pathToFileURL(t.iconImage).href; } catch (e) {} }   // fallback
    }
    else if (t.iconType === 'url' && t.iconCache) { out.iconSrc = imageFileToDataUrl(t.iconCache); }   // cached download -> data URL; null (gone) -> emoji fallback
    else if (t.iconType === 'app') { const d = await getAppIconDataUrl(t.value); if (d) out.iconSrc = d; }
    return out;
  }));
}
async function resolveGridIcons(grid) {
  if (grid.kind === 'app') return { ...grid, kind: 'web', url: appPageUrl(grid), themed: true };   // render the local app in the webview; themed:true -> panel injects live light/dark + accent
  if (grid.kind === 'web') return grid.gridOn ? { ...grid, tiles: await resolveTiles(grid.tiles) } : grid;   // dashboard: resolve the button-grid tile icons, else nothing to resolve
  return { ...grid, tiles: await resolveTiles(grid.tiles) };
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
function resolveAppPath(value) { return actionRunner.resolveAppPath(value, actionDeps); }
function launchAppValue(value) { actionRunner.launchApp(value, actionDeps).catch(e => console.log('app launch error:', e.message)); }
function runShellCommand(value) { return actionRunner.runShellCommand(value, actionDeps); }
function lockWorkstation() { return actionRunner.lockWorkstation(actionDeps); }

function runAction(a) {
  if (!a || typeof a.type !== 'string') return;
  if (a.value != null && typeof a.value !== 'string') return;   // value, when present, is always a string (url/app/cmd/open/page/system)
  if (a.type === 'system' && a.value === 'config') return openConfigWindow();
  console.log('launch:', a.label, '->', a.type, a.value);
  try {
    switch (a.type) {
      case 'url': openExternalUrl(a.value); break;
      case 'app': launchAppValue(a.value); break;
      case 'cmd': runShellCommand(a.value); break;
      case 'open': shell.openPath(a.value); break;
      case 'page': gotoGrid(a.value, true); if (rotateRunning) scheduleRotation(); break;   // switch the panel to another page
      case 'system':
        if (a.value === 'lock') lockWorkstation();
        else if (a.value === 'mic') toggleMic();
        else if (a.value === 'monitor') enterMonitorMode();   // hand the device screen to Windows; return via the tray
        break;
      case 'paste_text': pasteText(a.value); break;
      case 'counter': break;   // counter changes are saved by the panel directly via saveTileValue IPC; no main-process action needed on tap
    }
  } catch (e) { console.log('action error:', e.message); }
}

// Paste-text tile: write the configured text to the Windows clipboard, then synthesize Ctrl+V into the
// active foreground window. Clipboard.writeText is built into Electron; the Ctrl+V keystroke uses the
// existing media-keys backend (robotjs via @jitsi/robotjs). Note: this overwrites the user's clipboard.
function pasteText(value) {
  if (typeof value !== 'string' || value === '') return;
  try { clipboard.writeText(value); } catch (e) { console.log('pasteText clipboard error:', e.message); return; }
  // tiny delay so the clipboard has time to settle before Ctrl+V is sent
  setTimeout(() => { try { mediaKeys.pasteShortcut(); } catch (e) { console.log('pasteText keystroke error:', e.message); } }, 30);
}

// Media transport for the Music page. On Windows, drive the *exact* SMTC session the now-playing display
// is showing (matched by its app id) so the buttons control the same source — not whatever app currently
// owns the global media keys (which splits control from the display when several players are open). Fall
// back to the media-key tap if the helper can't act (no session, helper missing) or off-Windows.
const SMTC_CTL_CMDS = { playpause: 1, next: 1, prev: 1 };
function mediaKey(cmd) {
  if (process.platform === 'win32' && SMTC_CTL_CMDS[cmd] && fs.existsSync(SMTC_CTL_EXE)) {
    const snap = nowplaying.getSnapshot();
    const args = (snap && snap.app) ? [cmd, snap.app] : [cmd];   // target the displayed session by app id
    try {
      execFile(SMTC_CTL_EXE, args, { windowsHide: true, timeout: 4000 }, (err, stdout) => {
        if (err || String(stdout || '').trim() !== 'ok') mediaKeys.transport(cmd);   // helper miss -> media key
      });
      return true;
    } catch (e) { return mediaKeys.transport(cmd); }
  }
  return mediaKeys.transport(cmd);
}

function deviceDisplay() {
  return screen.getAllDisplays().find(d => (d.bounds.width === 480 && d.bounds.height === 1920) || (d.bounds.width === 1920 && d.bounds.height === 480));
}
function applyPanelDisplayMode(d) {
  panelWin.setBounds(d.bounds);
  panelWin.setMenuBarVisibility(false);
  if (process.platform === 'darwin') panelWin.setSimpleFullScreen(true);
  else panelWin.setFullScreen(true);
}
function placePanel() {
  if (monitorMode) return;                                          // in monitor mode the panel stays hidden — don't re-show it over the desktop
  const d = deviceDisplay();
  if (!d) { console.log('placePanel: DK-QUAKE display not present'); return; }
  if (!panelWin || panelWin.isDestroyed()) {
    panelWin = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, show: false, skipTaskbar: true, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: true, autoHideMenuBar: true,
      backgroundColor: '#000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'panel-preload.js'),
        webviewTag: true,
      },
    });
    panelWin.loadFile(path.join(__dirname, 'index.html'));
    panelWin.once('ready-to-show', () => {
      const dd = deviceDisplay() || d;
      applyPanelDisplayMode(dd); panelWin.setAlwaysOnTop(true); panelWin.show(); panelWin.focus();
      setTimeout(() => panelWin.setAlwaysOnTop(false), 1500);
      pushToPanel();
      console.log('panel display bounds', JSON.stringify(dd.bounds), 'workArea', JSON.stringify(dd.workArea));
      console.log('panel placed at', JSON.stringify(panelWin.getBounds()), 'fullscreen', panelWin.isFullScreen(), 'simpleFullscreen', panelWin.isSimpleFullScreen && panelWin.isSimpleFullScreen());
    });
  } else { applyPanelDisplayMode(d); panelWin.show(); pushToPanel(); }
}

// ---- monitor mode: use the device as a normal monitor ----
// Hide the launcher window so the Windows desktop shows on the device; the driver keep-alive keeps the
// backlight lit. Touch drives the OS cursor and the knob does a configurable action — both via the trusted
// device input only (mediaKeys / robotjs), never web content. The tray (or a System->monitor tile) toggles it.
function enterMonitorMode() {
  if (monitorMode || !panelWin || panelWin.isDestroyed()) return;
  monitorMode = true;
  try { if (process.platform === 'darwin') panelWin.setSimpleFullScreen(false); else panelWin.setFullScreen(false); } catch (e) {}
  panelWin.hide();
  syncPollers(null);                                                // nothing on the panel is visible -> idle the page pollers
  try { dev.screenOn(); } catch (e) {}                              // keep the backlight on as the desktop takes over
  refreshTray();
  console.log('monitor mode: ON (panel hidden, desktop visible)');
}
function exitMonitorMode(reason) {
  if (!monitorMode) return;
  monitorMode = false;
  releaseTouch();                                                   // drop any held mouse button from an in-progress touch
  if (panelWin && !panelWin.isDestroyed()) {
    const d = deviceDisplay();
    if (d) applyPanelDisplayMode(d);
    panelWin.setAlwaysOnTop(true); panelWin.show(); panelWin.focus();
    setTimeout(() => { try { panelWin.setAlwaysOnTop(false); } catch (e) {} }, 1500);
  }
  syncPollers(activeGrid());                                        // resume the active page's poller
  refreshTray();
  console.log('monitor mode: OFF (' + (reason || '') + ')');
}
function toggleMonitorMode() { monitorMode ? exitMonitorMode('tray') : enterMonitorMode(); }

// Monitor-mode touch -> OS cursor: tap = left-click, drag = move with the button held, lift = release.
// Maps the panel's bottom-left-origin coords (x:0..1920, y:0..480) onto the device monitor's screen rect.
function injectTouch(p) {
  if (!mediaKeys.available()) return;
  const d = deviceDisplay(); if (!d) return;
  const b = d.bounds;
  const x = Math.round(b.x + Math.max(0, Math.min(1920, p.x)));
  const y = Math.round(b.y + Math.max(0, Math.min(480, 480 - p.y)));   // device origin is bottom-left -> flip Y for the top-left screen
  clearTimeout(touchIdle);
  if (p.action === 1) {
    mediaKeys.moveMouse(x, y);
    if (!touchDown) { touchDown = true; mediaKeys.mouseToggle(true, 'left'); }
    touchIdle = setTimeout(releaseTouch, 140);
  } else releaseTouch();
}
function releaseTouch() { clearTimeout(touchIdle); if (touchDown) { touchDown = false; mediaKeys.mouseToggle(false, 'left'); } }

// Knob behavior in monitor mode (configurable on the editor's Monitor settings tab). Turn -> scroll or
// volume; single-tap -> Enter / left-click / right-click / mute. Exit is tray-only (knob stays free).
function monitorCfg() {
  const m = (config.settings || {}).monitor || {};
  return {
    knobTurn: m.knobTurn === 'volume' ? 'volume' : 'scroll',                         // default: scroll
    knobTap: ['leftclick', 'enter', 'rightclick', 'mute'].includes(m.knobTap) ? m.knobTap : 'enter',   // default: enter
  };
}
function monitorKnob(k) {
  const m = monitorCfg();
  if (k.type === 'rotate') {
    if (m.knobTurn === 'scroll') mediaKeys.scroll(k.dir > 0 ? -120 : 120);           // 120 = one wheel notch per detent
    else mediaKeys.volume(k.dir > 0 ? 1 : -1);
  } else if (k.type === 'press' && k.index === 1) {
    if (m.knobTap === 'leftclick') mediaKeys.click('left');
    else if (m.knobTap === 'enter') mediaKeys.tapKey('enter');
    else if (m.knobTap === 'rightclick') mediaKeys.click('right');
    else mediaKeys.volume('mute');
  }
}

function openConfigWindow() {
  if (configWin && !configWin.isDestroyed()) { configWin.show(); configWin.focus(); return; }
  const prim = screen.getPrimaryDisplay().bounds;
  configWin = new BrowserWindow({
    width: 1180, height: 760, x: prim.x + 80, y: prim.y + 60, title: 'open-quake Editor',
    backgroundColor: '#11151c',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'config-preload.js'),
    },
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
  const lig = (config.settings && config.settings.lighting) || {};
  let hue = L.hue, sat = L.sat;
  if (!lig.accentOverride) { const hs = hexToHsv255(themeGlobal().accent); if (hs) { hue = hs.hue; sat = hs.sat; } }   // ring follows the accent unless its color is overridden
  try { dev.setKnobLed(true); } catch (e) {}              // keep the ring from idle-sleeping (effect 0 = visually off)
  try { dev.setLedEffect(L.effect & 0xFF); } catch (e) {}
  try { dev.setLedBrightness(L.brightness & 0xFF); } catch (e) {}
  try { dev.setLedSpeed(L.speed & 0xFF); } catch (e) {}
  try { dev.setLedColor(hue & 0xFF, sat & 0xFF); } catch (e) {}
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
// Force the dashboard webview's cookies to commit to disk. Chromium only lazily flushes (~30s / clean
// shutdown), so a login made shortly before the app closes or is replaced by the next build can be lost
// (Electron #8416) — which is why claude.ai logins didn't survive build swaps. Debounced after navigations.
function flushDashCookies() {
  clearTimeout(cookieFlushT);
  cookieFlushT = setTimeout(() => { try { if (dashSession) dashSession.cookies.flushStore(); } catch (e) {} }, 2000);
}
// Per-page global hotkeys: register each page's `shortcut` so pressing it (system-wide) jumps the panel
// to that page. Re-applied on launch and after every editor save; a combo another app owns just fails to
// register (logged). Requires app-ready.
function applyShortcuts() {
  try { globalShortcut.unregisterAll(); } catch (e) {}
  for (const g of (config.grids || [])) {
    if (!g.shortcut) continue;
    try {
      const ok = globalShortcut.register(g.shortcut, () => { gotoGrid(g.id, true); if (rotateRunning) scheduleRotation(); });
      if (!ok) console.log('shortcut already in use, not registered:', g.shortcut, '->', g.id);
    } catch (e) { console.log('shortcut register error:', g.shortcut, '-', e.message); }
  }
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
    { label: monitorMode ? 'Monitor mode: on — click to return to panel' : 'Switch to monitor mode (use device as a normal monitor)', click: () => toggleMonitorMode() },
    { label: 'Re-place panel on device', enabled: !monitorMode, click: () => { try { dev.screenOn(); } catch (e) {} placePanel(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { try { dev.stop(); } catch (e) {} app.quit(); } },
  );
  return Menu.buildFromTemplate(items);
}
function refreshTray() { if (tray) tray.setContextMenu(trayMenu()); }
function createTray() {
  if (tray) return;
  let img;
  try {
    img = nativeImage.createFromBuffer(fs.readFileSync(path.join(__dirname, 'icon.png')));
    if (process.platform === 'darwin') {
      img = img.resize({ width: 18, height: 18 });   // macOS menu bar wants a small icon — the raw 256px app logo rendered as an oversized blob by the notch
      img.setTemplateImage(true);                      // monochrome menu-bar glyph that adapts to light/dark (macOS HIG)
    }
  } catch (e) { img = nativeImage.createEmpty(); }
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
  // safeStorage requires app-ready, so secrets loaded at module init are still encrypted strings in
  // `config` here — decrypt them in memory before anything reads a secret VALUE. If the on-disk config
  // still has plaintext secrets and encryption is now available, migrate it to encrypted-at-rest.
  const needsMigration = secretStore.hasPlaintextSecret(config);
  config = secretStore.decryptConfig(config);
  if (secretStore.available()) {
    if (needsMigration) saveConfig();                        // migrate plaintext config to encrypted-at-rest
  } else if (needsMigration) {
    console.log('safeStorage unavailable — config secrets kept in plaintext on disk (fallback)');
  }
  try { powerSaveBlocker.start('prevent-display-sleep'); } catch (e) {}
  createTray();
  // SystemView: live local metrics server on 127.0.0.1 (OS-assigned port) + ensure the dashboard page.
  // Lazy-required so a metrics/load failure can never crash the rest of the app.
  try {
    sysserver = require('./sysserver');
    serverPort = await sysserver.start({ onMedia: mediaKey, onLaunch: onMusicLaunch, getMusicTiles, getAppConfig: activeServedAppConfig, onOpenExternal: openExternalUrl, appFolders: discoveredServedApps() });
    ensureSystemViewPage(serverPort); ensureMusicPage();
    const env = loadEnv(); haschedule.configure({ url: env.HA_URL, token: env.HA_TOKEN });   // HA Schedule dev app creds
    console.log('SystemView + Music on http://127.0.0.1:' + serverPort + (env.HA_URL ? ' · HA Schedule -> ' + env.HA_URL : ''));
  } catch (e) { console.log('local panel services failed to start:', e.message); }
  sweepIconCache();   // clean up orphaned URL-icon cache files left by prior sessions

  // Dashboard auth injection for the webview session. The active page's auth config drives it:
  //  - 'header'  -> add custom header(s) to requests to the dashboard host (bearer / Cloudflare Access / …)
  //  - 'basic'   -> answer HTTP Basic Auth challenges with the configured user/pass
  // ('ha' token injection is done renderer-side; 'none' does nothing.)
  dashSession = session.fromPartition('persist:dashboards');
  dashSession.setPermissionRequestHandler(handleDashboardPermissionRequest);
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
  app.on('web-contents-created', (e, contents) => {
    if (contents.getType() !== 'webview') return;
    contents.on('did-navigate', flushDashCookies);                             // commit cookies (e.g. a fresh login) to disk after the page settles
  });

  ipcMain.on('launch', (e, a) => { if (!isFrom(e, panelWin)) return; runAction(a); });
  ipcMain.on('volume', (e, v) => { if (!isFrom(e, panelWin)) return; mediaKeys.volume(v); });
  ipcMain.on('switchGrid', (e, id) => { if (!isFrom(e, panelWin)) return; gotoGrid(id, true); if (rotateRunning) scheduleRotation(); });   // a manual pick resets the rotation timer
  ipcMain.on('toggleRotation', (e) => { if (!isFrom(e, panelWin)) return; toggleRotation(); });
  ipcMain.on('openConfig', (e) => { if (!isFrom(e, panelWin) && !isFrom(e, configWin)) return; openConfigWindow(); });
  ipcMain.on('introDone', (e) => { if (!isFrom(e, panelWin)) return; config.introShown = true; saveConfig(); });   // remember the intro was dismissed
  ipcMain.on('saveTileValue', (e, data) => {
    console.log('[counter] saveTileValue received:', JSON.stringify(data));
    if (!isFrom(e, panelWin)) { console.log('[counter] REJECTED: not from panelWin'); return; }
    if (!data || typeof data.gridId !== 'string' || !Number.isInteger(data.index) || typeof data.value !== 'string') {
      console.log('[counter] REJECTED: bad shape. gridId-type=', typeof (data&&data.gridId), 'index-type=', typeof (data&&data.index), 'index-isInt=', Number.isInteger(data&&data.index), 'value-type=', typeof (data&&data.value));
      return;
    }
    const g = (config.grids || []).find(x => x.id === data.gridId);
    if (!g) { console.log('[counter] REJECTED: no grid with id', data.gridId, '— grids are:', config.grids.map(x=>x.id)); return; }
    if (!Array.isArray(g.tiles) || !g.tiles[data.index]) { console.log('[counter] REJECTED: tile not found at index', data.index, 'in grid', data.gridId); return; }
    g.tiles[data.index].value = data.value;
    saveConfig();
    console.log('[counter] SAVED: grid', data.gridId, 'tile', data.index, '=', data.value);
  });
  ipcMain.on('openExternal', (e, url) => { if (!isFrom(e, panelWin) && !isFrom(e, configWin)) return; openExternalUrl(url); });
  ipcMain.handle('getConfig', (e) => isFrom(e, configWin) ? config : null);
  ipcMain.handle('getApps', (e) => {
    if (!isFrom(e, configWin)) return [];
    const catalog = appCatalog();
    try { if (sysserver && sysserver.setAppFolders) sysserver.setAppFolders(catalog.servedApps); } catch (er) {}
    return catalog.apps;
  });
  ipcMain.on('saveConfigFromEditor', (e, newCfg) => {
    if (!isFrom(e, configWin) || !newCfg || typeof newCfg !== 'object' || !Array.isArray(newCfg.grids)) return;
    const active = config.activeGridId;                          // the knob owns the live page — editor edits never change it
    const wasRot = rotationCfg().enabled;                        // detect a fresh off->on to auto-start (else keep the runtime pause)
    config = newCfg;
    if (config.grids.some(g => g.id === active)) config.activeGridId = active;
    else if (!config.grids.some(g => g.id === config.activeGridId)) config.activeGridId = (config.grids[0] || {}).id || null;
    saveConfig(); pushToPanel(); applyKnobSettings(); refreshTray(); applyRotationSettings(wasRot); applyShortcuts(); applyTheme();
  });
  ipcMain.handle('pickProgram', async (e) => {
    if (!isFrom(e, configWin)) return null;
    const filters = process.platform === 'darwin'
      ? [{ name: 'Applications', extensions: ['app'] }, { name: 'All Files', extensions: ['*'] }]
      : [{ name: 'Programs', extensions: ['exe', 'lnk', 'bat', 'cmd', 'com'] }, { name: 'All Files', extensions: ['*'] }];
    const r = await dialog.showOpenDialog(configWin, { properties: ['openFile'], filters });
    return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
  });
  ipcMain.handle('pickImage', async (e) => {
    if (!isFrom(e, configWin)) return null;
    const r = await dialog.showOpenDialog(configWin, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'] }, { name: 'All Files', extensions: ['*'] }] });
    return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
  });
  ipcMain.handle('getAppIcon', (e, value) => isFrom(e, configWin) ? getAppIconDataUrl(value) : null);
  ipcMain.handle('fetchIconUrl', (e, url) => isFrom(e, configWin) ? fetchIconToCache(url) : { ok: false, error: 'unauthorized' });

  ipcMain.handle('saveLightingToDevice', (e) => { if (!isFrom(e, configWin)) return false; try { return dev.saveLighting(); } catch (er) { return false; } });

  placePanel();
  if (rotationCfg().enabled) setRotation(true);          // auto-start cycling on launch when enabled
  applyShortcuts();                                       // register per-page global hotkeys
  applyTheme();                                           // set OS theme source (drives dashboards) + paint panel + knob accent
  nativeTheme.on('updated', () => { if (themeGlobal().appearance === 'system') applyTheme(); });   // follow the OS light/dark in System mode
  const ls = appSettings();
  if (firstRun || ls.launchMode === 'editor') openConfigWindow();
  else if (ls.launchMode === 'minimized') { openConfigWindow(); if (configWin && !configWin.isDestroyed()) configWin.minimize(); }
  // 'tray' -> stay quiet (tray + panel only)

  dev.on('touch', pts => {
    if (monitorMode) { const p = pts.find(q => q.action === 1) || pts[0]; if (p) injectTouch(p); return; }   // monitor mode: touch drives the Windows cursor
    if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('touch', pts);
  });
  dev.on('knob', k => {
    if (monitorMode) return monitorKnob(k);                                    // monitor mode: knob does the configured action (exit is tray-only)
    if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('knob', k);   // panel owns knob logic
  });
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
app.on('before-quit', () => {
  try { dev.stop(); } catch (e) {}                       // close HID devices + clear keep-alive/rescan timers — an open node-hid handle blocks process exit (Cmd+Q would hang -> force-quit)
  try { if (sysserver) sysserver.stop(); } catch (e) {}  // stop metrics timers + close the local server
  try { if (dashSession) dashSession.cookies.flushStore(); } catch (e) {}   // commit a fresh webview login to disk before exit
  try { globalShortcut.unregisterAll(); } catch (e) {}   // drop per-page hotkeys
});
