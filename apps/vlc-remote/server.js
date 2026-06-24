'use strict';

function optionString(options, key, fallback) {
  const value = options && options[key];
  return value == null || value === '' ? fallback : String(value);
}

function vlcBase(options) {
  const host = optionString(options, 'host', 'http://127.0.0.1:8080').replace(/\/+$/, '');
  return new URL(host);
}

function authHeader(options) {
  const password = optionString(options, 'password', '');
  return 'Basic ' + Buffer.from(':' + password, 'utf8').toString('base64');
}

function safeError(error) {
  return String(error && error.message || error || 'VLC request failed')
    .replace(/(password|passwd|pwd)=([^&\s]+)/ig, '$1=<hidden>');
}

async function vlcRequest(options, pathname, params) {
  const url = vlcBase(options);
  url.pathname = pathname;
  url.search = '';
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, value);
  });

  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(options),
      Accept: 'application/json',
    },
  });

  const text = await res.text();
  if (!res.ok) {
    const detail = text ? ' - ' + text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) : '';
    throw new Error('VLC returned HTTP ' + res.status + detail);
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error('VLC returned a non-JSON response');
  }
}

function commandParams(query) {
  const params = {};
  const command = query.command || query.cmd;
  if (command) params.command = command;
  if (query.val != null) params.val = query.val;
  if (query.id != null) params.id = query.id;
  if (query.input != null) params.input = query.input;
  return params;
}

async function handle(action, ctx) {
  const options = ctx && ctx.options || {};
  const query = ctx && ctx.query || {};

  try {
    if (action === 'status') return await vlcRequest(options, '/requests/status.json');
    if (action === 'playlist') return await vlcRequest(options, '/requests/playlist.json');
    if (action === 'command') return await vlcRequest(options, '/requests/status.json', commandParams(query));
    if (action === 'open') return await vlcRequest(options, '/requests/status.json', {
      command: 'in_play',
      input: query.input,
    });
    return { ok: false, error: 'unknown action' };
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}

module.exports = { handle };
