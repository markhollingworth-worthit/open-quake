'use strict';
/*
 * sysserver.js — tiny localhost HTTP server for the SystemView page. [MIT]
 *
 * Serves the dashboard HTML (GET /) and a live JSON snapshot (GET /metrics), bound to
 * 127.0.0.1 ONLY (never exposed on the network), GET-only. The panel shows SystemView as a
 * kind:"web" dashboard pointed at http://127.0.0.1:<port>/, so the page's fetch('/metrics')
 * is same-origin — no CORS, no mixed-content, no file:// pathing.
 *
 * Uses an OS-assigned ephemeral port (listen(0)) so there is no fixed-port collision; main.js
 * reconciles the SystemView page's url to the chosen port on every launch.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const metrics = require('./sysmetrics');

let server = null;
let pageHtml = '<!doctype html><meta charset="utf-8"><title>SystemView</title>'
  + '<body style="margin:0;background:#05080d;color:#9fb3c8;font:20px Segoe UI">SystemView page asset missing.</body>';

function handler(req, res) {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  const url = (req.url || '/').split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(pageHtml);
  } else if (url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(metrics.getSnapshot()));
  } else {
    res.writeHead(404); res.end();
  }
}

// Resolves with the assigned port. Reads the page asset once at startup (so packaged-app
// asar pathing is a non-issue — fs reads straight out of the asar before any serving).
function start() {
  return new Promise((resolve, reject) => {
    if (server) return resolve(server.address().port);
    try { pageHtml = fs.readFileSync(path.join(__dirname, 'sysview.html'), 'utf8'); } catch (e) { /* keep fallback */ }
    metrics.start();
    server = http.createServer(handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function stop() {
  metrics.stop();
  if (server) { try { server.close(); } catch (e) {} server = null; }
}

module.exports = { start, stop };
