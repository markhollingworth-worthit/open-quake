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
 *   GET /musictiles  -> the active Music page's embedded 2x2 grid (resolved icons)
 *   GET /media/<cmd> -> transport (play/pause/next/prev) via onMedia
 *   GET /launch?i=N  -> launch the active Music grid's tile N via onLaunch (runAction)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const metrics = require('./sysmetrics');
const nowplaying = require('./nowplaying');

const FALLBACK = '<!doctype html><meta charset="utf-8">'
  + '<body style="margin:0;background:#05080d;color:#9fb3c8;font:20px Segoe UI, sans-serif">page asset missing.</body>';
const MEDIA_CMDS = { playpause: 1, next: 1, prev: 1 };
const LOCAL_APP_CSP = [
  "default-src 'self' http: https: file: data: blob:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: file: http: https:",
  "font-src 'self' data:",
  "connect-src 'self' http: https:",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Static page assets served verbatim. Page scripts were moved out-of-line so the pages can run under a
// strict script-src 'self' (no 'unsafe-inline'); each extracted file is served here, keyed by request
// path (the on-disk name is the path minus its leading slash). Content-type per entry.
const STATIC_FILES = {
  '/ChatWidget.js': 'application/javascript; charset=utf-8',
  '/owui-widget.css': 'text/css; charset=utf-8',
  '/sysview.js': 'application/javascript; charset=utf-8',
  '/musicview.js': 'application/javascript; charset=utf-8',
  '/chatview-config.js': 'application/javascript; charset=utf-8',
  '/chatview-main.js': 'application/javascript; charset=utf-8',
  '/chatview-ptt.js': 'application/javascript; charset=utf-8',
};

let server = null, onMedia = null, onLaunch = null, getMusicTiles = null, getAppConfig = null;
let sysHtml = FALLBACK, musicHtml = FALLBACK, chatHtml = FALLBACK;
const staticAssets = {};   // request path -> { body, type }; populated at start()

function headers(type) { return { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': LOCAL_APP_CSP }; }
function html(res, body) { res.writeHead(200, headers('text/html; charset=utf-8')); res.end(body); }
function json(res, obj) { res.writeHead(200, headers('application/json; charset=utf-8')); res.end(JSON.stringify(obj)); }
function done(res, ok) { res.writeHead(ok ? 200 : 400, headers('application/json')); res.end(JSON.stringify({ ok: !!ok })); }

// Loopback-only hardening. The server binds 127.0.0.1, but a malicious web page (or a DNS-rebinding
// hostname that resolves to 127.0.0.1) can still try to reach it. hostOk() rejects any request whose
// Host header isn't our own loopback origin (the browser sets Host from the URL and JS can't forge it,
// so this defeats DNS rebinding). sameOrigin() additionally requires that side-effecting / data /
// secret routes come from our own served page (Sec-Fetch-Site, with an Origin fallback); the static
// page + asset routes stay reachable by the panel webview's top-level navigation.
function loopbackPort() { const a = server && server.address(); return a ? a.port : null; }
function hostOk(req) {
  const port = loopbackPort();
  if (port == null) return false;
  const host = req.headers.host;
  return host === '127.0.0.1:' + port || host === 'localhost:' + port;
}
function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin';                       // modern Chromium: only our own page's fetches
  const origin = req.headers.origin;
  if (!origin) return false;                                     // no Sec-Fetch AND no Origin: fail closed (our served pages always send Sec-Fetch-Site)
  try { const o = new URL(origin); return o.protocol === 'http:' && (o.hostname === '127.0.0.1' || o.hostname === 'localhost') && Number(o.port) === loopbackPort(); }
  catch (e) { return false; }
}

async function handler(req, res) {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  if (!hostOk(req)) { res.writeHead(403); res.end(); return; }   // foreign / DNS-rebinding Host -> reject (all routes)
  const full = req.url || '/';
  const url = full.split('?')[0];
  if (url === '/' || url === '/index.html') return html(res, sysHtml);
  if (url === '/music') return html(res, musicHtml);
  if (url === '/chat') return html(res, chatHtml);
  const asset = staticAssets[url];
  if (asset) { res.writeHead(200, headers(asset.type)); return res.end(asset.body); }
  // Below here: side effects (/launch, /media), live data (/metrics, /nowplaying, /musictiles), or
  // secrets (/app-config). Require the request to originate from our own served page — not a
  // cross-site fetch, image, form, or navigation.
  if (!sameOrigin(req)) { res.writeHead(403); res.end(); return; }
  if (url === '/app-config') {
    const m = /[?&]app=([A-Za-z0-9_-]+)/.exec(full);
    const cfg = (m && getAppConfig) ? getAppConfig(m[1]) : null;
    return cfg ? json(res, cfg) : done(res, false);
  }
  if (url === '/metrics') return json(res, metrics.getSnapshot());
  if (url === '/nowplaying') return json(res, nowplaying.getSnapshot());
  if (url === '/musictiles') {
    let t = { cols: 2, rows: 2, tiles: [] };
    if (getMusicTiles) { try { t = await getMusicTiles(); } catch (e) {} }
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

// opts: { onMedia(cmd), onLaunch(i), getMusicTiles(), getAppConfig(appId), getNowPlaying() } — all optional.
// getNowPlaying is an async now-playing source (e.g. the Spotify Web API client on macOS); when given,
// it becomes the now-playing provider and replaces the win32 SMTC poll (see nowplaying.setProvider).
function start(opts) {
  opts = opts || {};
  onMedia = opts.onMedia || null;
  onLaunch = opts.onLaunch || null;
  getMusicTiles = opts.getMusicTiles || null;
  getAppConfig = opts.getAppConfig || null;
  nowplaying.setProvider(opts.getNowPlaying || null);
  return new Promise((resolve, reject) => {
    if (server) return resolve(server.address().port);
    try { sysHtml = fs.readFileSync(path.join(__dirname, 'sysview.html'), 'utf8'); } catch (e) {}
    try { musicHtml = fs.readFileSync(path.join(__dirname, 'musicview.html'), 'utf8'); } catch (e) {}
    try { chatHtml = fs.readFileSync(path.join(__dirname, 'chatview.html'), 'utf8'); } catch (e) {}
    for (const [route, type] of Object.entries(STATIC_FILES)) {
      try { staticAssets[route] = { body: fs.readFileSync(path.join(__dirname, route.slice(1)), 'utf8'), type }; } catch (e) {}
    }
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
