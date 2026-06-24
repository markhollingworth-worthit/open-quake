'use strict';

const query = new URLSearchParams(location.search);
const mockMode = query.get('mock') === '1' || query.get('mock') === 'true';
const refreshSeconds = Math.max(1, Math.min(30, parseInt(query.get('refreshSeconds'), 10) || 2));
const streamUrl = query.get('streamUrl') || '';

const state = {
  timer: null,
  clockTimer: null,
  status: null,
  playlist: [],
  playlistSearch: '',
  busy: false,
};

const $ = selector => document.querySelector(selector);

function formatTime(seconds) {
  const n = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = Math.floor(n % 60);
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateClock() {
  const el = $('#deck-clock');
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function apiUrl(action, params) {
  const url = new URL(`/app-api/${action}`, location.origin);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, value);
  });
  return url.pathname + url.search;
}

async function api(action, params) {
  if (mockMode) return mockApi(action, params);
  const res = await fetch(apiUrl(action, params), { cache: 'no-store' });
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (e) {
    payload = { ok: false, error: text || 'Invalid VLC response' };
  }
  if (!res.ok || payload.ok === false) throw new Error(payload.error || `VLC request failed (${res.status})`);
  return payload;
}

function setOnline(online, detail) {
  $('#status-pill').classList.toggle('online', online);
  $('#status-text').textContent = online ? 'Online' : 'Offline';
  if (detail && !state.status) $('#track-meta').textContent = detail;
}

function currentTitle(status) {
  const info = status.information || {};
  const category = info.category || {};
  const meta = category.meta || info.meta || {};
  return meta.title || meta.filename || status.title || status.name || 'Untitled media';
}

function currentMeta(status) {
  const info = status.information || {};
  const category = info.category || {};
  const meta = category.meta || info.meta || {};
  return [meta.artist, meta.album, status.state].filter(Boolean).join(' - ') || 'VLC web interface connected';
}

function renderStatus(status) {
  state.status = status;
  setOnline(true);
  $('#track-title').textContent = currentTitle(status);
  $('#track-meta').textContent = currentMeta(status);
  const playToggle = $('#play-toggle');
  playToggle.querySelector('span').textContent = status.state === 'playing' ? '||' : '>';
  playToggle.querySelector('small').textContent = status.state === 'playing' ? 'Pause' : 'Play';

  const duration = Number(status.length) || 0;
  const elapsed = Number(status.time) || 0;
  $('#elapsed').textContent = formatTime(elapsed);
  $('#duration').textContent = formatTime(duration);
  $('#progress-fill').style.width = duration ? `${Math.max(0, Math.min(100, (elapsed / duration) * 100))}%` : '0%';

  const volume = Math.round(((Number(status.volume) || 0) / 256) * 100);
  $('#volume-label').textContent = `${Math.max(0, Math.min(125, volume))}%`;
}

function flattenPlaylist(nodes, rows) {
  (nodes || []).forEach(node => {
    if (node.type === 'leaf') rows.push(node);
    if (Array.isArray(node.children)) flattenPlaylist(node.children, rows);
  });
  return rows;
}

function playlistDuration(rows) {
  const seconds = rows.reduce((sum, row) => sum + (Number(row.duration) > 0 ? Number(row.duration) : 0), 0);
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function renderPlaylistRows() {
  const needle = state.playlistSearch.trim().toLowerCase();
  const rows = needle
    ? state.playlist.filter(row => String(row.name || row.uri || '').toLowerCase().includes(needle))
    : state.playlist;
  const activeId = state.status && String(state.status.currentplid || '');
  const summary = playlistDuration(state.playlist);
  const summaryEl = $('#playlist-summary');
  if (summaryEl) summaryEl.textContent = `${state.playlist.length} item${state.playlist.length === 1 ? '' : 's'}${summary ? ' - ' + summary : ''}`;
  $('#playlist').innerHTML = rows.length ? rows.slice(0, 100).map((row, index) => {
    const active = activeId && String(row.id) === activeId;
    const duration = row.duration && row.duration > 0 ? formatTime(row.duration) : '';
    return `
      <button class="playlist-row ${active ? 'active' : ''}" type="button" data-play-id="${esc(row.id)}">
        <span class="playlist-index">${index + 1}</span>
        <span class="playlist-play">${active ? '>' : ''}</span>
        <strong class="playlist-title">${esc(row.name || row.uri || 'Playlist item')}</strong>
        <span class="playlist-duration">${esc(duration)}</span>
      </button>`;
  }).join('') : `<div class="empty">${state.playlist.length ? 'No matching playlist items' : 'Playlist is empty'}</div>`;
}

function renderPlaylist(payload) {
  state.playlist = flattenPlaylist(payload.children || payload.playlist || [], []);
  renderPlaylistRows();
}

function renderError(error) {
  setOnline(false, error.message || 'VLC web interface unavailable');
  $('#track-meta').textContent = error.message || 'Unable to reach VLC';
  if (!state.status) $('#playlist').innerHTML = '<div class="error">Unable to load playlist</div>';
}

async function refresh() {
  try {
    const [status, playlist] = await Promise.all([
      api('status'),
      api('playlist'),
    ]);
    renderStatus(status);
    renderPlaylist(playlist);
  } catch (e) {
    renderError(e);
  } finally {
    clearTimeout(state.timer);
    state.timer = setTimeout(refresh, refreshSeconds * 1000);
  }
}

async function sendCommand(command, params) {
  if (state.busy) return;
  state.busy = true;
  try {
    await api('command', Object.assign({ command }, params || {}));
    await refresh();
  } catch (e) {
    renderError(e);
  } finally {
    state.busy = false;
  }
}

function setupVideo() {
  const panel = $('#preview-panel');
  const video = $('#video-player');
  if (!streamUrl) {
    panel.hidden = true;
    return;
  }
  video.src = streamUrl;
  panel.hidden = false;
}

function setupEvents() {
  document.querySelectorAll('[data-command]').forEach(button => {
    button.addEventListener('click', () => {
      const command = button.getAttribute('data-command');
      const val = button.getAttribute('data-val');
      sendCommand(command, val == null ? null : { val });
    });
  });

  $('#refresh-button').addEventListener('click', refresh);
  $('#playlist-tab').addEventListener('click', () => {
    $('#playlist-page').classList.add('open');
    $('#playlist-page').setAttribute('aria-hidden', 'false');
  });
  $('#playlist-open').addEventListener('click', () => {
    $('#playlist-page').classList.add('open');
    $('#playlist-page').setAttribute('aria-hidden', 'false');
  });
  $('#playlist-close').addEventListener('click', () => {
    $('#playlist-page').classList.remove('open');
    $('#playlist-page').setAttribute('aria-hidden', 'true');
  });
  $('#playlist-search').addEventListener('input', event => {
    state.playlistSearch = event.target.value;
    renderPlaylistRows();
  });
  $('#playlist-clear').addEventListener('click', () => {
    sendCommand('pl_empty');
  });

  $('#playlist').addEventListener('click', event => {
    const row = event.target.closest('[data-play-id]');
    if (!row) return;
    sendCommand('pl_play', { id: row.getAttribute('data-play-id') });
    $('#playlist-page').classList.remove('open');
    $('#playlist-page').setAttribute('aria-hidden', 'true');
  });
}

function mockApi(action, params) {
  const status = {
    ok: true,
    state: mockApi.playing ? 'playing' : 'paused',
    time: Math.floor((Date.now() / 1000) % 1800),
    length: 3600,
    volume: 176,
    currentplid: 2,
    information: {
      category: {
        meta: {
          title: 'Big Buck Bunny',
          artist: 'Blender Foundation',
          album: 'Local desktop VLC',
        },
      },
    },
  };
  const playlist = {
    ok: true,
    children: [{
      name: 'Playlist',
      children: [
        { id: 1, type: 'leaf', name: 'Open Quake trailer.mp4', duration: 212 },
        { id: 2, type: 'leaf', name: 'Big Buck Bunny', duration: 3600 },
        { id: 3, type: 'leaf', name: 'NAS movie night.m3u8', duration: 5420 },
      ],
    }],
  };
  if (action === 'command' && params && params.command === 'pl_pause') mockApi.playing = !mockApi.playing;
  return Promise.resolve(action === 'playlist' ? playlist : status);
}
mockApi.playing = true;

setupVideo();
setupEvents();
updateClock();
state.clockTimer = setInterval(updateClock, 1000);
refresh();
