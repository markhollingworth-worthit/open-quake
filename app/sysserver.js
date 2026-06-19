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
 *   GET /media/<cmd> -> transport (play/pause/next/prev/stop) via onMedia
 *   GET /launch?i=N  -> launch the active Music grid's tile N via onLaunch (runAction)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const metrics = require('./sysmetrics');
const nowplaying = require('./nowplaying');

const FALLBACK = '<!doctype html><meta charset="utf-8">'
  + '<body style="margin:0;background:#05080d;color:#9fb3c8;font:20px Segoe UI">page asset missing.</body>';
const MEDIA_CMDS = { playpause: 1, next: 1, prev: 1, stop: 1 };

let server = null, onMedia = null, onLaunch = null, getMusicTiles = null;
let sysHtml = FALLBACK, musicHtml = FALLBACK;

function html(res, body) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); }
function json(res, obj) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function done(res, ok) { res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ ok: !!ok })); }

async function handler(req, res) {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  const full = req.url || '/';
  const url = full.split('?')[0];
  if (url === '/' || url === '/index.html') return html(res, sysHtml);
  if (url === '/music') return html(res, musicHtml);
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

// opts: { onMedia(cmd), onLaunch(i), getMusicTiles() } — all optional.
function start(opts) {
  opts = opts || {};
  onMedia = opts.onMedia || null;
  onLaunch = opts.onLaunch || null;
  getMusicTiles = opts.getMusicTiles || null;
  return new Promise((resolve, reject) => {
    if (server) return resolve(server.address().port);
    try { sysHtml = fs.readFileSync(path.join(__dirname, 'sysview.html'), 'utf8'); } catch (e) {}
    try { musicHtml = fs.readFileSync(path.join(__dirname, 'musicview.html'), 'utf8'); } catch (e) {}
    metrics.start();
    nowplaying.start();
    server = http.createServer((req, res) => { handler(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch (e) {} }); });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function stop() {
  metrics.stop();
  nowplaying.stop();
  if (server) { try { server.close(); } catch (e) {} server = null; }
}

module.exports = { start, stop };
