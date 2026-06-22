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
 *   GET /media/<cmd> -> transport (play/pause/next/prev/stop) via onMedia
 *   GET /launch?i=N  -> launch the active Music grid's tile N via onLaunch (runAction)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const metrics = require('./sysmetrics');
const nowplaying = require('./nowplaying');
const QnapClient = require('./qnapClient');

const APPS_DIR = path.join(__dirname, '..', 'apps').replace('app.asar', 'app.asar.unpacked');
const FALLBACK = '<!doctype html><meta charset="utf-8">'
  + '<body style="margin:0;background:#05080d;color:#9fb3c8;font:20px Segoe UI">page asset missing.</body>';
const MEDIA_CMDS = { playpause: 1, next: 1, prev: 1, stop: 1 };

let server = null, onMedia = null, onLaunch = null, getMusicTiles = null, getQnapOptions = null;
let sysHtml = FALLBACK, musicHtml = FALLBACK, chatHtml = FALLBACK, qnapHtml = FALLBACK;
let chatJs = '', chatCss = '', qnapJs = '', qnapCss = '';
let qnapClient = null, qnapClientKey = '', qnapLastGood = null;
let servedAppDirs = new Map();

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
function qnapConfigFromOptions(opts) {
  opts = opts || {};
  const refreshSeconds = Math.max(5, Math.min(300, parseInt(opts.refreshSeconds, 10) || 15));
  return {
    qnap: {
      host: String(opts.host || '').replace(/\/+$/, ''),
      username: String(opts.username || ''),
      password: String(opts.password || ''),
      verifySsl: !!opts.verifySsl,
    },
    dashboard: { refreshSeconds },
  };
}
function activeQnapClient() {
  const cfg = qnapConfigFromOptions(getQnapOptions ? getQnapOptions() : {});
  const key = JSON.stringify(cfg.qnap);
  if (!qnapClient || key !== qnapClientKey) {
    qnapClient = new QnapClient(cfg);
    qnapClientKey = key;
    qnapLastGood = null;
  } else {
    qnapClient.config.dashboard = cfg.dashboard;
  }
  return qnapClient;
}
async function qnapSummary() {
  const data = await activeQnapClient().getSummary();
  if (data.ok) qnapLastGood = data;
  else if (qnapLastGood) data.lastGood = qnapLastGood;
  return data;
}
async function qnapResources() {
  return activeQnapClient().getResources();
}

async function handler(req, res) {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  const full = req.url || '/';
  const url = full.split('?')[0];
  if (url === '/' || url === '/index.html') return html(res, sysHtml);
  if (url === '/music') return html(res, musicHtml);
  if (url === '/chat') return html(res, chatHtml);
  if (url === '/qnap') return html(res, qnapHtml);
  if (url === '/ChatWidget.js') return asset(res, chatJs, 'application/javascript; charset=utf-8');
  if (url === '/owui-widget.css') return asset(res, chatCss, 'text/css; charset=utf-8');
  if (url === '/qnap/qnapview.js') return asset(res, qnapJs, 'application/javascript; charset=utf-8');
  if (url === '/qnap/qnapview.css') return asset(res, qnapCss, 'text/css; charset=utf-8');
  if (serveDropInApp(url, res)) return;
  if (url === '/metrics') return json(res, metrics.getSnapshot());
  if (url === '/nowplaying') return json(res, nowplaying.getSnapshot());
  if (url === '/api/qnap/summary' || url === '/api/qnap/status' || url === '/api/qnap/system-health') return json(res, await qnapSummary());
  if (url === '/api/qnap/resources') return json(res, await qnapResources());
  if (url === '/api/qnap/storage') { const s = await qnapSummary(); return json(res, s.storage); }
  if (url === '/api/qnap/shares') { const s = await qnapSummary(); return json(res, s.shares); }
  if (url === '/api/qnap/recent-files') { const s = await qnapSummary(); return json(res, s.recentFiles); }
  if (url === '/api/qnap/network') { const s = await qnapSummary(); return json(res, s.network); }
  if (url === '/api/qnap/services') { const s = await qnapSummary(); return json(res, s.services); }
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

// opts: { onMedia(cmd), onLaunch(i), getMusicTiles() } — all optional.
function start(opts) {
  opts = opts || {};
  onMedia = opts.onMedia || null;
  onLaunch = opts.onLaunch || null;
  getMusicTiles = opts.getMusicTiles || null;
  getQnapOptions = opts.getQnapOptions || null;
  servedAppDirs = new Map();
  (opts.servedApps || []).forEach(a => {
    if (a && a.id && a.baseDir) servedAppDirs.set(a.id, { baseDir: a.baseDir, entry: a.entry || a.file || 'index.html' });
  });
  return new Promise((resolve, reject) => {
    if (server) return resolve(server.address().port);
    try { sysHtml = fs.readFileSync(path.join(__dirname, 'sysview.html'), 'utf8'); } catch (e) {}
    try { musicHtml = fs.readFileSync(path.join(__dirname, 'musicview.html'), 'utf8'); } catch (e) {}
    try { chatHtml = fs.readFileSync(path.join(__dirname, 'chatview.html'), 'utf8'); } catch (e) {}
    try { qnapHtml = fs.readFileSync(path.join(__dirname, 'qnapview.html'), 'utf8'); } catch (e) {}
    try { chatJs = fs.readFileSync(path.join(__dirname, 'ChatWidget.js'), 'utf8'); } catch (e) {}
    try { chatCss = fs.readFileSync(path.join(__dirname, 'owui-widget.css'), 'utf8'); } catch (e) {}
    try { qnapJs = fs.readFileSync(path.join(__dirname, 'qnapview.js'), 'utf8'); } catch (e) {}
    try { qnapCss = fs.readFileSync(path.join(__dirname, 'qnapview.css'), 'utf8'); } catch (e) {}
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
