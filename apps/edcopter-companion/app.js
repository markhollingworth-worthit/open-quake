'use strict';

const params = new URLSearchParams(location.search);

const settings = {
  serverUrl: cleanBaseUrl(params.get('serverUrl') || 'http://192.168.1.100:4600'),
  autoConnect: readBool(params.get('autoConnect'), true),
  reconnect: readBool(params.get('reconnect'), true),
  showStatus: readBool(params.get('showStatus'), true),
  showTicker: readBool(params.get('showTicker'), true),
  demoMode: readBool(params.get('demoMode'), false),
  verifySsl: readBool(params.get('verifySsl'), true),
};

const POLL_MS = 3000;

const els = {
  app: document.getElementById('app'),
  statusBadge: document.getElementById('statusBadge'),
  diagnostics: document.getElementById('diagnostics'),
  offlineDetails: document.getElementById('offlineDetails'),
  activityList: document.getElementById('activityList'),
  ticker: document.getElementById('ticker'),
  tickerTrack: document.getElementById('tickerTrack'),
  progressFill: document.getElementById('progressFill'),
};

const fields = Object.fromEntries(Array.from(document.querySelectorAll('[data-field]')).map(el => [el.dataset.field, el]));

const state = {
  socket: null,
  reconnectTimer: null,
  pollTimer: null,
  demoTimer: null,
  clockTimer: null,
  status: 'waiting',
  events: [],
  voiceLog: [],
  voiceLogTotal: 0,
  lastVoiceRenderKey: '',
  lastTickerRenderKey: '',
  snapshot: {
    commander: 'Waiting',
    ship: 'Unassigned',
    flightMode: 'Standby',
    system: '--',
    body: '--',
    station: '--',
    lastUpdate: '--',
    sessionName: 'No active session',
    progress: 0,
    cargoCount: 0,
    sessionValue: 0,
    missions: 0,
    bookmarks: 0,
  },
};

const demo = {
  index: 0,
  events: [
    ['Docked', 'Docked at Jameson Memorial'],
    ['Jumped', 'Jumped to LHS 20'],
    ['Mission Updated', 'Wing delivery objective updated'],
    ['Cargo Collected', 'Collected 18t Painite'],
    ['Discovery Scan', 'Discovery scan complete in Shinrarta Dezhra'],
    ['Bookmark Added', 'Route bookmark synced'],
  ],
  voice: [
    ['Copilot', 'Route confirmed to LHS 20.'],
    ['Ship', 'Frame shift drive charging.'],
    ['Copilot', 'Mission cargo manifest checked.'],
    ['Ship', 'Docking request granted.'],
  ],
  systems: ['Shinrarta Dezhra', 'LHS 20', 'Deciat', 'Sol', 'Maia'],
  bodies: ['A 1', 'Ohm City Orbital', 'Farseer Inc', 'Mars High', 'Maia A 3 A'],
  stations: ['Jameson Memorial', 'Ohm City', 'Farseer Inc', 'Galileo', 'Obsidian Orbital'],
};

init();

function init() {
  els.app.classList.toggle('no-ticker', !settings.showTicker);
  els.statusBadge.hidden = !settings.showStatus;
  renderAll();
  startClock();

  if (settings.demoMode) {
    startDemo();
    return;
  }

  if (settings.autoConnect) connect();
  else setStatus('waiting', 'Auto Connect is off.', 'Waiting for manual configuration.');
}

function connect() {
  clearReconnect();
  clearPolling();
  setStatus('waiting', 'Opening EDCoPTER link.', `Target ${settings.serverUrl || 'not configured'}`);

  if (!settings.serverUrl) {
    setStatus('error', 'No EDCoPTER Server URL configured.', 'Add the server URL in panel settings.');
    scheduleReconnect();
    return;
  }

  fetchInitialData();
  startPolling();
  if (canUseBrowserWebSocket()) {
    connectSocket();
  } else {
    setStatus('waiting', 'Using server-side polling for self-signed HTTPS.', 'WebSocket certificate checks cannot be bypassed in the browser.');
  }
}

async function fetchInitialData() {
  const responses = await Promise.allSettled([
    fetchJson('/api/integration/status'),
    fetchJson('/api/integration/state'),
    fetchJson('/api/integration/events'),
    fetchJson('/api/integration/voice-log'),
  ]);

  responses.forEach((result, index) => {
    if (result.status !== 'fulfilled' || !result.value) return;
    if (index === 3) consumeVoiceLogPayload(result.value);
    else consumePayload(result.value);
  });

  const ok = responses.some(result => result.status === 'fulfilled');
  if (ok && state.status !== 'connected') setStatus('connected', 'EDCoPTER HTTP data received.', 'Awaiting live integration stream.');
  if (!ok && state.status !== 'connected') {
    const reason = responses.find(result => result.status === 'rejected');
    const message = reason && reason.reason ? reason.reason.message : 'No HTTP response from EDCoPTER.';
    setStatus('disconnected', message, `Retrying every 10 seconds: ${settings.serverUrl}`);
    scheduleReconnect();
  }
}

function connectSocket() {
  closeSocket();
  const wsUrl = toWebSocketUrl(settings.serverUrl, '/ws/integration');
  if (!wsUrl) return;

  try {
    const socket = new WebSocket(wsUrl);
    state.socket = socket;

    socket.addEventListener('open', () => {
      setStatus('connected', 'Live EDCoPTER stream connected.', wsUrl);
      clearReconnect();
    });

    socket.addEventListener('message', event => {
      const payload = parseMaybeJson(event.data);
      if (payload) consumePayload(payload);
    });

    socket.addEventListener('close', () => {
      if (state.socket === socket) state.socket = null;
      if (state.status !== 'error') setStatus('disconnected', 'Live EDCoPTER stream closed.', `Reconnecting to ${wsUrl}`);
      scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      setStatus('disconnected', 'WebSocket connection failed.', `Check EDCoPTER is reachable at ${wsUrl}`);
      scheduleReconnect();
    });
  } catch (error) {
    setStatus('error', error.message, 'Unable to create WebSocket.');
    scheduleReconnect();
  }
}

async function fetchJson(path) {
  const response = await fetch(`/app-api/fetch?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${path}`);
  const text = await response.text();
  const payload = parseMaybeJson(text);
  if (payload && payload.ok === false && payload.error) throw new Error(payload.error);
  return payload;
}

function consumePayload(payload) {
  if (!payload) return;

  const data = payload.data || payload.payload || payload.state || payload;
  const summary = data.lastSnapshotSummary || payload.lastSnapshotSummary || {};
  updateVoiceLogTotal(payload, data, summary);
  const snapshot = normalizeSnapshot(data);
  const changed = mergeSnapshot(snapshot);

  const incomingEvents = normalizeEvents(payload.events || data.events || payload.recentEvents || data.recentEvents || (Array.isArray(payload) ? payload : null));
  if (incomingEvents.length) {
    incomingEvents.reverse().forEach(addEvent);
  } else if (payload.type || payload.event || payload.name) {
    addEvent(normalizeEvent(payload));
  }

  const latestEvent = payload.latestEvent || data.latestEvent || summary.latestEvent;
  if (latestEvent) addEvent(normalizeEvent(latestEvent));

  const incomingVoiceLog = normalizeVoiceLog(firstArray(
    payload.voiceLog,
    data.voiceLog,
    payload.voiceLogs,
    data.voiceLogs,
    payload.voice_log,
    data.voice_log,
    payload.latestVoiceLog ? [payload.latestVoiceLog] : null,
    data.latestVoiceLog ? [data.latestVoiceLog] : null,
    summary.latestVoiceLog ? [summary.latestVoiceLog] : null
  ));
  if (incomingVoiceLog.length) incomingVoiceLog.reverse().forEach(addVoiceLogEntry);

  if (changed) renderSnapshot();
  renderEvents();
  setStatus(settings.demoMode ? 'demo' : 'connected', settings.demoMode ? 'Demo mode active.' : 'Live EDCoPTER data received.', `Last packet ${timeOnly(new Date())}`);
}

function consumeVoiceLogPayload(payload) {
  const data = payload && (payload.data || payload.payload || payload.voiceLog || payload);
  updateVoiceLogTotal(payload, data);
  const incoming = normalizeVoiceLog(firstArray(
    payload,
    data,
    payload && payload.entries,
    payload && payload.items,
    payload && payload.logs,
    payload && payload.log,
    payload && payload.voiceLog,
    payload && payload.voiceLogs,
    payload && payload.voice_log,
    data && data.entries,
    data && data.items,
    data && data.logs,
    data && data.log,
    data && data.voiceLog,
    data && data.voiceLogs,
    data && data.voice_log,
    payload && payload.latestVoiceLog ? [payload.latestVoiceLog] : null,
    data && data.latestVoiceLog ? [data.latestVoiceLog] : null
  ));
  if (!incoming.length) return;
  incoming.reverse().forEach(addVoiceLogEntry);
  renderEvents();
}

function normalizeSnapshot(data) {
  const commander = data.commander || data.commanderName || data.cmdr || data.Cmdr || data.profile && data.profile.commander;
  const ship = data.ship || data.currentShip || data.shipName || data.vehicle && data.vehicle.name;
  const location = data.location || data.flight || data.nav || data.journal || {};
  const session = data.session || data.activeSession || {};
  const cargo = data.cargo || {};
  const missions = data.missions || data.activeMissions;
  const bookmarks = data.bookmarks || data.bookmarkCount;

  return {
    commander,
    ship,
    flightMode: data.flightMode || data.mode || location.mode,
    system: data.currentSystem || data.system || location.system || location.StarSystem,
    body: data.currentBody || data.body || location.body || location.Body,
    station: data.currentStation || data.station || location.station || location.StationName,
    lastUpdate: data.lastUpdate || data.updatedAt || data.timestamp || new Date().toISOString(),
    sessionName: session.name || data.sessionName,
    progress: firstNumber(session.progress, session.progressPercent, data.sessionProgress, data.progress),
    cargoCount: firstNumber(cargo.count, cargo.total, data.cargoCount),
    sessionValue: firstNumber(session.estimatedValue, session.value, data.estimatedSessionValue, data.sessionValue),
    missions: Array.isArray(missions) ? missions.length : firstNumber(missions, data.activeMissionCount, data.activeMissions),
    bookmarks: Array.isArray(bookmarks) ? bookmarks.length : firstNumber(bookmarks, data.bookmarkCount),
  };
}

function normalizeEvents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeEvent).filter(Boolean).slice(0, 24);
}

function normalizeVoiceLog(raw) {
  if (!Array.isArray(raw)) return [];
  state.voiceLogTotal = Math.max(state.voiceLogTotal, raw.length);
  return raw.map(normalizeVoiceLogEntry).filter(Boolean).slice(0, 100);
}

function normalizeEvent(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return { time: new Date().toISOString(), type: 'Event', text: raw };

  const type = raw.type || raw.event || raw.name || raw.kind || 'Event';
  const place = raw.station || raw.system || raw.body || raw.location || '';
  const message = raw.message || raw.text || raw.description || raw.summary || formatEventText(type, place);
  const time = readTime(raw);
  return {
    id: raw.id || `${time} ${type} ${message}`,
    time,
    type,
    text: message,
  };
}

function normalizeVoiceLogEntry(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return { time: new Date().toISOString(), speaker: 'Voice', text: raw };

  const speaker = raw.speaker || raw.source || raw.role || raw.name || 'Voice';
  const text = raw.text || raw.message || raw.transcript || raw.phrase || raw.summary || '';
  if (!text) return null;
  const time = readTime(raw);

  return {
    id: raw.id || `${time} ${speaker} ${text}`,
    time,
    speaker,
    text,
  };
}

function formatEventText(type, place) {
  const label = titleCase(type);
  return place ? `${label} at ${place}` : label;
}

function mergeSnapshot(next) {
  let changed = false;
  Object.entries(next).forEach(([key, value]) => {
    if (value == null || value === '') return;
    if (state.snapshot[key] !== value) {
      state.snapshot[key] = value;
      changed = true;
    }
  });
  return changed;
}

function addEvent(event) {
  if (!event) return;
  const duplicate = event.id && state.events.some(existing => existing.id === event.id);
  if (duplicate) return;
  state.events.unshift(event);
  state.events = state.events.slice(0, 18);
}

function addVoiceLogEntry(entry) {
  if (!entry) return;
  const duplicate = entry.id && state.voiceLog.some(existing => existing.id === entry.id);
  if (duplicate) return;
  state.voiceLog.unshift(entry);
  state.voiceLog.sort((a, b) => dateValue(b.time) - dateValue(a.time));
  state.voiceLog = state.voiceLog.slice(0, 100);
  state.voiceLogTotal = Math.max(state.voiceLogTotal, state.voiceLog.length);
}

function renderAll() {
  renderSnapshot();
  renderEvents();
  renderStatus();
}

function renderSnapshot() {
  const s = state.snapshot;
  updateField('commander', s.commander);
  updateField('ship', s.ship);
  updateField('flightMode', s.flightMode);
  updateField('system', s.system);
  updateField('body', s.body);
  updateField('station', s.station);
  updateField('lastUpdate', formatTime(s.lastUpdate));
  updateField('sessionName', s.sessionName);
  updateField('progressText', `${clampPercent(s.progress)}%`);
  updateField('cargoCount', formatNumber(s.cargoCount));
  updateField('sessionValue', formatCredits(s.sessionValue));
  updateField('missions', formatNumber(s.missions));
  updateField('bookmarks', formatNumber(s.bookmarks));
  els.progressFill.style.width = `${clampPercent(s.progress)}%`;
}

function renderEvents() {
  const visible = state.events.slice(0, 6);
  const eventRenderKey = visible.map(event => `${event.id || ''}|${event.time}|${event.type}|${event.text}`).join('\n');
  updateField('eventCount', `${state.events.length} ${state.events.length === 1 ? 'event' : 'events'}`);

  if (eventRenderKey !== state.lastVoiceRenderKey) {
    state.lastVoiceRenderKey = eventRenderKey;
    els.activityList.textContent = '';

    if (!visible.length) {
      const row = document.createElement('div');
      row.className = 'event';
      row.innerHTML = '<time>--:--</time><strong>No recent activity</strong>';
      els.activityList.append(row);
    } else {
      visible.forEach(event => {
        const row = document.createElement('div');
        row.className = 'event';
        row.innerHTML = `<time>${esc(timeOnly(event.time))}</time><strong>${esc(event.text || event.type)}</strong>`;
        els.activityList.append(row);
      });
    }
  }

  if (settings.showTicker) {
    const latestVoiceLog = state.voiceLog[0] || { time: new Date(), text: 'Waiting for EDCoPTER voice log', speaker: 'Voice' };
    const tickerItems = [`<span>[${esc(timeOnly(latestVoiceLog.time))}]</span> ${esc(formatVoiceLogText(latestVoiceLog))}`];
    const tickerRenderKey = tickerItems.join('\n');
    if (tickerRenderKey !== state.lastTickerRenderKey) {
      state.lastTickerRenderKey = tickerRenderKey;
      els.tickerTrack.innerHTML = tickerItems.concat(tickerItems).join('');
      els.tickerTrack.style.animationDuration = `${tickerDuration([latestVoiceLog])}s`;
    }
  }
}

function formatVoiceLogText(entry) {
  const speakerName = String(entry.speaker || '').trim();
  const isGenericSpeaker = !speakerName || ['default', 'voice', 'unknown'].includes(speakerName.toLowerCase());
  const speaker = isGenericSpeaker ? '' : `${speakerName}: `;
  return `${speaker}${entry.text}`;
}

function tickerDuration(events) {
  const textLength = events
    .slice(0, 10)
    .reduce((total, event) => total + String(event.text || event.type || '').length + 12, 0);
  return Math.max(46, Math.min(110, Math.round(textLength * 0.42)));
}

function updateVoiceLogTotal(...sources) {
  sources.forEach(source => {
    if (!source || Array.isArray(source)) return;
    const count = firstNumber(source.voiceLogCount, source.voice_log_count, source.total, source.count);
    if (count != null) state.voiceLogTotal = Math.max(state.voiceLogTotal, count);
  });
}

function setStatus(status, diagnostic, details) {
  state.status = status;
  renderStatus();
  if (diagnostic) els.diagnostics.textContent = diagnostic;
  if (details) els.offlineDetails.textContent = details;
}

function renderStatus() {
  els.app.classList.remove('waiting', 'connected', 'disconnected', 'error', 'demo');
  els.app.classList.add(state.status);
  const label = state.status === 'connected' ? 'Connected'
    : state.status === 'demo' ? 'Demo Mode'
    : state.status === 'error' ? 'Error'
    : state.status === 'disconnected' ? 'Disconnected'
    : 'Waiting';
  updateField('connection', label);
}

function startDemo() {
  setStatus('demo', 'Demo mode active with simulated EDCoPTER telemetry.', 'Live server connection is disabled.');
  mergeSnapshot({
    commander: 'Astra Vale',
    ship: 'Krait Mk II - Wayfinder',
    flightMode: 'Supercruise',
    system: 'Shinrarta Dezhra',
    body: 'A 1',
    station: 'Jameson Memorial',
    lastUpdate: new Date().toISOString(),
    sessionName: 'Rescue Materials Run',
    progress: 42,
    cargoCount: 64,
    sessionValue: 18420000,
    missions: 3,
    bookmarks: 12,
  });
  demo.events.slice(0, 4).forEach(([type, text]) => addEvent({ time: new Date().toISOString(), type, text }));
  demo.voice.slice(0, 4).forEach(([speaker, text]) => addVoiceLogEntry({ time: new Date().toISOString(), speaker, text }));
  renderAll();

  clearInterval(state.demoTimer);
  state.demoTimer = setInterval(() => {
    demo.index += 1;
    const slot = demo.index % demo.events.length;
    const progress = (state.snapshot.progress + 7) % 101;
    mergeSnapshot({
      flightMode: slot % 3 === 0 ? 'Docked' : slot % 3 === 1 ? 'Hyperspace' : 'Supercruise',
      system: demo.systems[slot % demo.systems.length],
      body: demo.bodies[slot % demo.bodies.length],
      station: demo.stations[slot % demo.stations.length],
      lastUpdate: new Date().toISOString(),
      progress,
      cargoCount: 48 + ((demo.index * 7) % 72),
      sessionValue: 18420000 + demo.index * 375000,
      missions: 2 + (demo.index % 4),
      bookmarks: 12 + (demo.index % 5),
    });
    const [type, text] = demo.events[slot];
    addEvent({ time: new Date().toISOString(), type, text });
    const [speaker, line] = demo.voice[slot % demo.voice.length];
    addVoiceLogEntry({ time: new Date().toISOString(), speaker, text: line });
    renderAll();
  }, 4200);
}

function scheduleReconnect() {
  if (settings.demoMode || !settings.reconnect) return;
  clearReconnect();
  state.reconnectTimer = setTimeout(connect, 10000);
}

function clearReconnect() {
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
}

function closeSocket() {
  if (!state.socket) return;
  try { state.socket.close(); } catch (error) {}
  state.socket = null;
}

function startPolling() {
  clearPolling();
  state.pollTimer = setInterval(fetchInitialData, POLL_MS);
}

function clearPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

function canUseBrowserWebSocket() {
  try {
    const url = new URL(settings.serverUrl);
    return !(url.protocol === 'https:' && !settings.verifySsl);
  } catch (error) {
    return false;
  }
}

function startClock() {
  clearInterval(state.clockTimer);
  state.clockTimer = setInterval(() => {
    if (state.snapshot.lastUpdate && state.snapshot.lastUpdate !== '--') {
      updateField('lastUpdate', formatTime(state.snapshot.lastUpdate));
    }
  }, 1000);
}

function updateField(key, value) {
  const el = fields[key];
  if (!el) return;
  const text = value == null || value === '' ? '--' : String(value);
  if (el.textContent === text) return;
  el.textContent = text;
  el.classList.remove('changed');
  void el.offsetWidth;
  el.classList.add('changed');
}

function readBool(value, fallback) {
  if (value == null || value === '') return fallback;
  return value === true || value === 'true' || value === '1' || value === 'yes';
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

function toWebSocketUrl(base, path) {
  try {
    const url = new URL(base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = path;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch (error) {
    return '';
  }
}

function parseMaybeJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (error) { return { message: String(value) }; }
}

function readTime(raw) {
  return raw.timestamp || raw.Timestamp || raw.time || raw.Time || raw.createdAt || raw.CreatedAt
    || raw.updatedAt || raw.UpdatedAt || raw.receivedAt || raw.ReceivedAt
    || raw.date || raw.Date || raw.datetime || raw.DateTime || new Date().toISOString();
}

function dateValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function firstArray(...values) {
  return values.find(Array.isArray) || null;
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : '0';
}

function formatCredits(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0 CR';
  if (n >= 1000000000) return `${(n / 1000000000).toFixed(2)}B CR`;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M CR`;
  return `${Math.round(n).toLocaleString()} CR`;
}

function formatTime(value) {
  if (!value || value === '--') return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${timeOnly(date)} (${ageText(date)})`;
}

function timeOnly(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ageText(date) {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function titleCase(value) {
  return String(value || 'Event')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
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
