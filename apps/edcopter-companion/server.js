'use strict';

const http = require('http');
const https = require('https');

const ALLOWED_PATHS = new Set([
  '/api/integration/status',
  '/api/integration/state',
  '/api/integration/events',
  '/api/integration/voice-log',
]);

async function handle(action, context) {
  if (action !== 'fetch') return { ok: false, error: 'unknown action' };

  const path = String(context.query && context.query.path || '');
  if (!ALLOWED_PATHS.has(path)) return { ok: false, error: 'path not allowed' };

  const baseUrl = cleanBaseUrl(context.options && context.options.serverUrl);
  if (!baseUrl) return { ok: false, error: 'EDCoPTER Server URL is not configured' };

  const target = new URL(path, baseUrl);
  const verifySsl = boolValue(context.options && context.options.verifySsl, true);
  return requestJson(target, verifySsl);
}

function requestJson(target, verifySsl) {
  return new Promise((resolve, reject) => {
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(target, {
      method: 'GET',
      timeout: 5000,
      rejectUnauthorized: verifySsl,
      headers: {
        Accept: 'application/json, */*',
        'User-Agent': 'open-quake-edcopter-companion',
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode || 500) >= 400) {
          resolve({ ok: false, error: `EDCoPTER returned HTTP ${res.statusCode}` });
          return;
        }
        resolve(parseJson(text));
      });
    });

    req.on('timeout', () => req.destroy(new Error('EDCoPTER request timed out')));
    req.on('error', err => reject(err));
    req.end();
  });
}

function parseJson(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch (error) { return { message: text }; }
}

function cleanBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href.replace(/\/+$/, '');
  } catch (error) {
    return '';
  }
}

function boolValue(value, fallback) {
  if (value == null || value === '') return fallback;
  return value === true || value === 'true' || value === '1' || value === 1;
}

module.exports = { handle };
