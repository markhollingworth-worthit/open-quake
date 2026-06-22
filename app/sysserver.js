'use strict';
/*
 * sysserver.js — tiny localhost HTTP server for the on-panel SystemView + Music app pages. [MIT]
 *
 * Bound to 127.0.0.1 ONLY (never exposed on the network), GET-only. Each page is shown as a panel
 * page pointed at http://127.0.0.1:<port>/… , so its fetches are same-origin — no CORS, no
 * mixed-content. OS-assigned ephemeral port (listen(0)); appPageUrl()/ensure* in main.js use the port.
 *
 * Routes:
 *   GET /            -> SystemView page        GET /metrics      -> system metrics JSON
 *   GET /music       -> Music app page         GET /nowplaying   -> SMTC now-playing JSON
 *   GET /apps/<id>/… -> drop-in served app assets
 *   GET /musictiles  -> the active Music page's embedded 2x2 grid (resolved icons)
 *   GET /apptiles    -> the active app page's embedded grid (resolved icons)
 *   GET /media/<cmd> -> transport (play/pause/next/prev/stop) via onMedia
 *   GET /launch?i=N  -> launch the active app grid's tile N via onLaunch (runAction)
 *   GET /app-proxy   -> generic active drop-in app network proxy, gated by app.json
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const metrics = require('./sysmetrics');
const nowplaying = require('./nowplaying');

const APPS_DIR = path.join(__dirname, '..', 'apps').replace('app.asar', 'app.asar.unpacked');
const FALLBACK = '<!doctype html><meta charset="utf-8">'
  + '<body style="margin:0;background:#05080d;color:#9fb3c8;font:20px Segoe UI">page asset missing.</body>';
const MEDIA_CMDS = { playpause: 1, next: 1, prev: 1, stop: 1 };

let server = null, onMedia = null, onLaunch = null, getMusicTiles = null, getAppTiles = null, getActiveApp = null;
let sysHtml = FALLBACK, musicHtml = FALLBACK, chatHtml = FALLBACK;
let chatJs = '', chatCss = '';
let servedAppDirs = new Map();
let proxyCookies = new Map();
let appServerModules = new Map();

function html(res, body) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); }
function json(res, obj) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function done(res, ok) { res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ ok: !!ok })); }
function asset(res, body, type) { res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); }
function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.woff') return 'font/woff';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}
function insideDir(parent, child) {
  const a = path.resolve(parent).toLowerCase();
  const b = path.resolve(child).toLowerCase();
  return b === a || b.startsWith(a + path.sep);
}
function serveDropInApp(reqUrl, res) {
  const m = /^\/apps\/([^/]+)(?:\/(.*))?$/.exec(reqUrl);
  if (!m) return false;
  const id = decodeURIComponent(m[1]);
  const appDef = servedAppDirs.get(id);
  if (!appDef) { res.writeHead(404); res.end(); return true; }
  let rel = m[2] ? decodeURIComponent(m[2]) : (appDef.entry || 'index.html');
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  if (rel.indexOf('\0') >= 0 || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) {
    res.writeHead(400); res.end(); return true;
  }
  const baseDir = appDef.baseDir || path.join(APPS_DIR, id);
  const file = path.resolve(baseDir, rel);
  if (!insideDir(baseDir, file)) { res.writeHead(403); res.end(); return true; }
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) { res.writeHead(404); res.end(); return true; }
    return asset(res, fs.readFileSync(file), mimeFor(file)), true;
  } catch (e) {
    res.writeHead(404); res.end(); return true;
  }
}
function optionValue(options, key) {
  return options && Object.prototype.hasOwnProperty.call(options, key) ? options[key] : null;
}
function boolValue(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}
function proxySourceAllowed(target, source, options) {
  if (!source) return false;
  if (source.option) {
    const configured = optionValue(options, source.option);
    if (!configured) return false;
    try { return new URL(configured).origin === target.origin; } catch (e) { return false; }
  }
  if (source.origin && source.origin === target.origin) return true;
  if (source.pattern) {
    try { return new RegExp(source.pattern).test(target.href); } catch (e) { return false; }
  }
  return false;
}
function proxyAllowed(appDef, active, target, method) {
  const proxy = appDef && appDef.proxy;
  if (!proxy || active.app !== appDef.id) return { ok: false, error: 'proxy not allowed for active app' };
  const methods = (proxy.methods || ['GET']).map(x => String(x).toUpperCase());
  if (!methods.includes(method)) return { ok: false, error: 'method not allowed' };
  const allow = Array.isArray(proxy.allow) ? proxy.allow : [];
  const allowed = allow.some(source => proxySourceAllowed(target, source, active.options || {}));
  if (!allowed) return { ok: false, error: 'target not allowed' };
  const verifyOpt = proxy.verifySslOption;
  const rejectUnauthorized = verifyOpt ? boolValue(optionValue(active.options || {}, verifyOpt)) : true;
  return { ok: true, rejectUnauthorized };
}
function proxyError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Open-Quake-Proxy': 'error' });
  res.end(JSON.stringify({ ok: false, error: message }));
}
function proxyCookieKey(appId, origin) {
  return appId + ' ' + origin;
}
function proxyCookieHeader(appId, origin) {
  const jar = proxyCookies.get(proxyCookieKey(appId, origin));
  return jar ? Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ') : '';
}
function storeProxyCookies(appId, origin, setCookie) {
  const rows = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
  if (!rows.length) return;
  const key = proxyCookieKey(appId, origin);
  const jar = proxyCookies.get(key) || {};
  rows.forEach(row => {
    const first = String(row).split(';')[0];
    const idx = first.indexOf('=');
    if (idx > 0) jar[first.slice(0, idx).trim()] = first.slice(idx + 1).trim();
  });
  proxyCookies.set(key, jar);
}
function activeProxyApp() {
  const active = getActiveApp ? getActiveApp() : null;
  if (!(active && active.kind === 'app' && active.app)) return null;
  const appDef = servedAppDirs.get(active.app);
  if (!appDef) return null;
  return { active, appDef };
}
function loadAppServer(appDef) {
  if (!(appDef && appDef.server)) return null;
  if (appServerModules.has(appDef.id)) return appServerModules.get(appDef.id);
  const rel = String(appDef.server || '');
  if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return null;
  const file = path.resolve(appDef.baseDir, rel);
  if (!insideDir(appDef.baseDir, file)) return null;
  try {
    const mod = require(file);
    appServerModules.set(appDef.id, mod);
    return mod;
  } catch (e) {
    console.log('app server module load error:', appDef.id, e.message);
    appServerModules.set(appDef.id, null);
    return null;
  }
}
async function serveAppApi(fullUrl, res) {
  const ctx = activeProxyApp();
  if (!ctx) return proxyError(res, 403, 'active app is not server-enabled');
  const mod = loadAppServer(ctx.appDef);
  if (!(mod && typeof mod.handle === 'function')) return proxyError(res, 404, 'active app has no server handler');
  const action = decodeURIComponent(fullUrl.split('?')[0].slice('/app-api/'.length) || '');
  const query = Object.fromEntries(new URL('http://127.0.0.1' + fullUrl).searchParams.entries());
  try {
    return json(res, await mod.handle(action, { options: ctx.active.options || {}, query }));
  } catch (e) {
    return proxyError(res, 500, e.message);
  }
}
function serveAppProxyConfig(res) {
  const ctx = activeProxyApp();
  if (!ctx || !ctx.appDef.proxy) return proxyError(res, 403, 'active app is not proxy-enabled');
  return json(res, { ok: true, app: ctx.active.app, options: ctx.active.options || {} });
}
async function serveAppProxy(fullUrl, req, res) {
  const ctx = activeProxyApp();
  if (!ctx) return proxyError(res, 403, 'active app is not proxy-enabled');
  const { active, appDef } = ctx;
  const params = new URL('http://127.0.0.1' + fullUrl).searchParams;
  const targetRaw = params.get('url');
  if (!targetRaw) return proxyError(res, 400, 'missing url');
  let target;
  try { target = new URL(targetRaw); } catch (e) { return proxyError(res, 400, 'invalid url'); }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return proxyError(res, 400, 'unsupported protocol');
  const method = (params.get('method') || req.method || 'GET').toUpperCase();
  const gate = proxyAllowed(appDef, active, target, method);
  if (!gate.ok) return proxyError(res, 403, gate.error);
  const lib = target.protocol === 'https:' ? https : http;
  const cookie = proxyCookieHeader(active.app, target.origin);
  const headers = {
    Accept: params.get('accept') || 'application/json, text/xml, */*',
    Referer: target.origin + '/',
    'User-Agent': 'open-quake-app-proxy',
  };
  if (cookie) headers.Cookie = cookie;
  const upstream = lib.request(target, {
    method,
    timeout: Math.max(1000, Math.min(30000, parseInt(params.get('timeout'), 10) || 8000)),
    rejectUnauthorized: gate.rejectUnauthorized,
    headers,
  }, upstreamRes => {
    storeProxyCookies(active.app, target.origin, upstreamRes.headers['set-cookie']);
    const chunks = [];
    upstreamRes.on('data', chunk => chunks.push(chunk));
    upstreamRes.on('end', () => {
      res.writeHead(upstreamRes.statusCode || 502, {
        'Content-Type': String(upstreamRes.headers['content-type'] || 'application/octet-stream'),
        'Cache-Control': 'no-store',
        'X-Open-Quake-Proxy': 'upstream',
      });
      res.end(Buffer.concat(chunks));
    });
  });
  upstream.on('timeout', () => upstream.destroy(new Error('proxy request timed out')));
  upstream.on('error', e => proxyError(res, 502, e.message));
  upstream.end();
}
async function handler(req, res) {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  const full = req.url || '/';
  const url = full.split('?')[0];
  if (url.indexOf('/app-api/') === 0) return serveAppApi(full, res);
  if (url === '/app-proxy/config') return serveAppProxyConfig(res);
  if (url === '/app-proxy') return serveAppProxy(full, req, res);
  if (url === '/' || url === '/index.html') return html(res, sysHtml);
  if (url === '/music') return html(res, musicHtml);
  if (url === '/chat') return html(res, chatHtml);
  if (url === '/ChatWidget.js') return asset(res, chatJs, 'application/javascript; charset=utf-8');
  if (url === '/owui-widget.css') return asset(res, chatCss, 'text/css; charset=utf-8');
  if (serveDropInApp(url, res)) return;
  if (url === '/metrics') return json(res, metrics.getSnapshot());
  if (url === '/nowplaying') return json(res, nowplaying.getSnapshot());
  if (url === '/musictiles') {
    let t = { cols: 2, rows: 2, tiles: [] };
    if (getMusicTiles) { try { t = await getMusicTiles(); } catch (e) {} }
    return json(res, t);
  }
  if (url === '/apptiles') {
    let t = { cols: 1, rows: 1, tiles: [] };
    if (getAppTiles) { try { t = await getAppTiles(); } catch (e) {} }
    return json(res, t);
  }
  if (url.indexOf('/media/') === 0) {
    const cmd = url.slice(7);
    let ok = false;
    if (MEDIA_CMDS[cmd] && typeof onMedia === 'function') { try { ok = !!onMedia(cmd); } catch (e) {} }
    return done(res, ok);
  }
  if (url === '/launch') {
    const m = /[?&]i=(\d+)/.exec(full);
    let ok = false;
    if (m && typeof onLaunch === 'function') { try { ok = !!onLaunch(parseInt(m[1], 10)); } catch (e) {} }
    return done(res, ok);
  }
  res.writeHead(404); res.end();
}

// opts: { onMedia(cmd), onLaunch(i), getMusicTiles(), getAppTiles() } — all optional.
function start(opts) {
  opts = opts || {};
  onMedia = opts.onMedia || null;
  onLaunch = opts.onLaunch || null;
  getMusicTiles = opts.getMusicTiles || null;
  getAppTiles = opts.getAppTiles || null;
  getActiveApp = opts.getActiveApp || null;
  servedAppDirs = new Map();
  proxyCookies = new Map();
  appServerModules = new Map();
  (opts.servedApps || []).forEach(a => {
    if (a && a.id && a.baseDir) servedAppDirs.set(a.id, { id: a.id, baseDir: a.baseDir, entry: a.entry || a.file || 'index.html', proxy: a.proxy || null, server: a.server || null });
  });
  return new Promise((resolve, reject) => {
    if (server) return resolve(server.address().port);
    try { sysHtml = fs.readFileSync(path.join(__dirname, 'sysview.html'), 'utf8'); } catch (e) {}
    try { musicHtml = fs.readFileSync(path.join(__dirname, 'musicview.html'), 'utf8'); } catch (e) {}
    try { chatHtml = fs.readFileSync(path.join(__dirname, 'chatview.html'), 'utf8'); } catch (e) {}
    try { chatJs = fs.readFileSync(path.join(__dirname, 'ChatWidget.js'), 'utf8'); } catch (e) {}
    try { chatCss = fs.readFileSync(path.join(__dirname, 'owui-widget.css'), 'utf8'); } catch (e) {}
    // NB: the pollers are NOT started here. They're gated by which panel page is shown — main.js
    // calls setActivePage() on every page switch so each poller runs only while its page is on screen.
    server = http.createServer((req, res) => { handler(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch (e) {} }); });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

// Run only the poller the visible page needs; stop the others. Called by main.js whenever the
// active panel page changes. which: 'sysview' (metrics) | 'music' (now-playing) | null (neither).
// start()/stop() are idempotent, so this is safe to call on every page push.
function setActivePage(which) {
  if (which === 'sysview') { metrics.start(); nowplaying.stop(); }
  else if (which === 'music') { nowplaying.start(); metrics.stop(); }
  else { metrics.stop(); nowplaying.stop(); }
}

function stop() {
  metrics.stop();
  nowplaying.stop();
  if (server) { try { server.close(); } catch (e) {} server = null; }
}

module.exports = { start, stop, setActivePage };
