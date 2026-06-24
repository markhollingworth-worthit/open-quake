'use strict';

const query = new URLSearchParams(location.search);
const summaryUrl = query.get('summaryUrl') || '';
let qnapHost = String(query.get('host') || '').replace(/\/+$/, '');
let qnapUser = query.get('username') || '';
let qnapPass = query.get('password') || '';
let configPromise = null;
const mockMode = query.get('mock') === '1' || query.get('mock') === 'true';
const refreshSeconds = Math.max(5, Math.min(300, parseInt(query.get('refreshSeconds'), 10) || 30));
const REFRESH_MS = refreshSeconds * 1000;
const state = {
  lastGood: null,
  lastError: null,
  timer: null,
  clockTimer: null,
  nextRefresh: null,
  visibleGeneratedAt: null,
};

const $ = selector => document.querySelector(selector);

function setLoadingStatus(text) {
  const el = $('#loading-status');
  if (el) el.textContent = text;
}

function finishLoading() {
  const overlay = $('#loading-overlay');
  if (!overlay || overlay.classList.contains('done')) return;
  overlay.classList.add('done');
  setTimeout(() => {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }, 260);
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

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampPercent(value) {
  const n = numberOrNull(value);
  return n == null ? null : Math.max(0, Math.min(100, Math.round(n)));
}

function display(value, fallback) {
  return value == null || value === '' ? (fallback || '--') : String(value);
}

function pct(value) {
  const n = clampPercent(value);
  return n == null ? '--' : `${n}%`;
}

function bytes(value) {
  const n = numberOrNull(value);
  if (n == null) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let amount = n;
  let i = 0;
  while (amount >= 1024 && i < units.length - 1) {
    amount /= 1024;
    i += 1;
  }
  const formatted = amount >= 10 || i === 0 ? Math.round(amount) : amount.toFixed(1);
  return `${formatted} ${units[i]}`;
}

function bps(value) {
  const n = numberOrNull(value);
  return n == null ? '--' : `${bytes(n)}/s`;
}

function dateParts(value) {
  const d = value ? new Date(value) : new Date();
  return {
    time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    date: d.toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' }),
  };
}

function ageText(value) {
  if (!value) return '--';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m ago`;
}

function updateLiveTimes() {
  const now = dateParts();
  document.querySelectorAll('[data-live-clock-time]').forEach(el => { el.textContent = now.time; });
  document.querySelectorAll('[data-live-clock-date]').forEach(el => { el.textContent = now.date; });
  document.querySelectorAll('[data-last-updated-age]').forEach(el => {
    el.textContent = `Last updated ${ageText(state.visibleGeneratedAt)}`;
  });
}

function startLiveClock() {
  if (state.clockTimer) return;
  updateLiveTimes();
  state.clockTimer = setInterval(updateLiveTimes, 1000);
}

function statusClass(value) {
  const text = String(value || '').toLowerCase();
  if (/critical|failed|fail|offline|error|bad/.test(text)) return 'bad';
  if (/warn|degraded|limited|unavailable|unknown|n\/a/.test(text)) return 'warn';
  return 'ok';
}

function statusLabel(value, fallback) {
  if (value == null || value === '') return fallback || 'Unavailable';
  const text = String(value);
  if (text === '0' || text === '1') return 'Good';
  if (text === '2') return 'Warning';
  if (text === '3') return 'Critical';
  return text;
}

function gauge(label, value, size) {
  const n = clampPercent(value);
  const deg = n == null ? 0 : n * 3.6;
  const accent = n != null && n >= 90 ? 'var(--red)' : n != null && n >= 75 ? 'var(--amber)' : label === 'RAM' ? 'var(--blue)' : 'var(--green)';
  return `
    <div class="gauge ${size || ''} ${n == null ? 'unknown' : ''}" style="--value:${deg}deg;--accent:${accent}">
      <span class="gauge-value">${n == null ? '--' : n + '%'}</span>
      <span class="gauge-label">${esc(label)}</span>
    </div>`;
}

function bar(value) {
  const n = clampPercent(value) || 0;
  return `<div class="bar"><i style="width:${n}%"></i></div>`;
}

function badge(text) {
  const label = statusLabel(text, 'Unavailable');
  const cls = statusClass(label);
  return `<span class="status-badge ${cls === 'ok' ? '' : cls}">${esc(label)}</span>`;
}

function freeFromPool(pool) {
  if (pool.freeBytes != null) return pool.freeBytes;
  const total = numberOrNull(pool.totalBytes);
  const used = numberOrNull(pool.usedBytes);
  if (total != null && used != null) return Math.max(0, total - used);
  return null;
}

function normalizeDashboard(payload) {
  const system = payload.system || {};
  const storage = payload.storage || {};
  const network = payload.network || {};

  // Expected summary payload shape mirrors the original QNAP dashboard data:
  // system/model/firmware/auth, storage.pools, shares, recentFiles, diskHealth/disks,
  // services, and network resource values. Missing fields stay visible as "--".
  const totalBytes = numberOrNull(storage.totalBytes);
  const usedBytes = numberOrNull(storage.usedBytes);
  const freeBytes = totalBytes != null && usedBytes != null ? Math.max(0, totalBytes - usedBytes) : null;
  const pools = Array.isArray(storage.pools) ? storage.pools : [];
  const shares = Array.isArray(payload.shares) ? payload.shares : [];
  const recentFiles = Array.isArray(payload.recentFiles) ? payload.recentFiles : [];
  const rawDisks = Array.isArray(payload.disks) ? payload.disks
    : payload.diskHealth && Array.isArray(payload.diskHealth.disks) ? payload.diskHealth.disks
    : [];
  const services = Array.isArray(payload.services) ? payload.services : [];

  return {
    ok: payload.ok !== false,
    online: payload.online !== false && payload.ok !== false,
    error: payload.error || null,
    generatedAt: payload.generatedAt || new Date().toISOString(),
    system: {
      name: system.name || payload.name || 'QNAP NAS',
      model: system.model || payload.model || null,
      firmware: system.firmware || payload.firmware || null,
      uptime: system.uptime || null,
      cpuPercent: system.cpuPercent,
      ramPercent: system.ramPercent,
      statusText: system.statusText || (payload.ok === false ? 'Offline' : 'Online'),
      auth: payload.auth || system.auth || null,
    },
    storage: {
      totalBytes,
      usedBytes,
      freeBytes,
      percentUsed: storage.percentUsed,
      pools,
    },
    network: {
      downloadBps: network.downloadBps,
      uploadBps: network.uploadBps,
      interfaces: Array.isArray(network.interfaces) ? network.interfaces : [],
    },
    diskHealth: {
      status: payload.diskHealth && payload.diskHealth.status || 'Unavailable',
      healthy: payload.diskHealth && payload.diskHealth.healthy,
      warning: payload.diskHealth && payload.diskHealth.warning,
      disks: normalizeDisks(rawDisks, storage),
    },
    shares,
    recentFiles,
    services,
    alerts: Array.isArray(payload.alerts) ? payload.alerts : [],
  };
}

function normalizeDisks(disks, storage) {
  if (disks.length) {
    return disks.slice(0, 4).map((disk, index) => ({
      name: disk.name || disk.id || `Disk ${index + 1}`,
      size: disk.sizeBytes != null ? bytes(disk.sizeBytes) : display(disk.size, '--'),
      status: disk.status || disk.health || 'Good',
    }));
  }

  const total = numberOrNull(storage.totalBytes);
  const perDisk = total ? bytes(total / 4) : '--';
  const poolStatus = storage.pools && storage.pools.some(pool => /warn|degrad|fail/i.test(pool.status || ''))
    ? 'Warning'
    : 'Good';
  return [1, 2, 3, 4].map(i => ({
    name: `Bay ${i}`,
    size: perDisk,
    status: storage.percentUsed == null ? 'Unavailable' : poolStatus,
  }));
}

function renderHeader(data) {
  const clock = dateParts();
  const onlineClass = data.online ? 'ok' : 'bad';
  $('#header').innerHTML = `
    <div class="header-brand">
      <div class="qnap-mark">Q</div>
      <div>
        <div class="brand-title">QNAP Open Quake</div>
        <div class="brand-subtitle">${esc(display(data.system.name, 'QNAP NAS'))}</div>
      </div>
    </div>
    <div class="header-block">
      <div class="header-label">NAS Model</div>
      <div class="header-value">${esc(display(data.system.model, 'Unavailable'))}</div>
    </div>
    <div class="header-block">
      <div class="header-label">Status</div>
      <div class="header-value header-status ${onlineClass === 'ok' ? '' : onlineClass}">
        <span class="status-dot ${onlineClass === 'ok' ? '' : onlineClass}"></span>${data.online ? 'Online' : 'Offline'}
      </div>
    </div>
    <div class="header-block">
      <div class="header-label">Uptime</div>
      <div class="header-value">${esc(display(data.system.uptime, '--'))}</div>
    </div>
    <div class="header-block">
      <div class="header-label">CPU</div>
      <div class="header-value">${pct(data.system.cpuPercent)}</div>
    </div>
    <div class="header-block">
      <div class="header-label">RAM</div>
      <div class="header-value">${pct(data.system.ramPercent)}</div>
    </div>
    <div class="header-block">
      <div class="header-label">LAN Down / Up</div>
      <div class="header-value">${bps(data.network.downloadBps)} / ${bps(data.network.uploadBps)}</div>
    </div>
    <div class="clock-block">
      <div class="clock-time" data-live-clock-time>${esc(clock.time)}</div>
      <div class="clock-date" data-live-clock-date>${esc(clock.date)}</div>
    </div>
    <div class="settings-button" title="Settings"></div>`;
}

function renderSystem(data) {
  $('#system-card').innerHTML = `
    <div class="card-title"><span>System</span><span>${esc(display(data.system.statusText, 'Unavailable'))}</span></div>
    <div class="system-layout">
      ${gauge('CPU', data.system.cpuPercent)}
      ${gauge('RAM', data.system.ramPercent)}
      <div class="detail-stack">
        <div class="kv-row"><strong class="model-value">${esc(display(data.system.model, 'Unavailable'))}</strong></div>
        <div class="kv-row"><strong class="firmware-value">${esc(display(data.system.firmware, 'Unavailable'))}</strong></div>
      </div>
    </div>`;
}

function renderStorageOverview(data) {
  $('#storage-overview-card').innerHTML = `
    <div class="card-title"><span>Storage Overview</span><span>${pct(data.storage.percentUsed)} used</span></div>
    <div class="storage-overview-layout">
      ${gauge('Used', data.storage.percentUsed, 'big')}
      <div>
        <div class="headline">${esc(display(bytes(data.storage.totalBytes), '--'))}</div>
        <div class="subline">Total capacity</div>
        ${bar(data.storage.percentUsed)}
        <div class="capacity-grid">
          <div class="mini-stat"><span class="metric-label">Used</span><strong>${esc(bytes(data.storage.usedBytes))}</strong></div>
          <div class="mini-stat"><span class="metric-label">Free</span><strong>${esc(bytes(data.storage.freeBytes))}</strong></div>
        </div>
      </div>
    </div>`;
}

function renderStoragePools(data) {
  const rows = data.storage.pools.slice(0, 4);
  $('#storage-pools-card').innerHTML = `
    <div class="card-title"><span>Storage Pools</span><span>${rows.length || 0} active</span></div>
    <div class="rows">
      ${rows.length ? rows.map((pool, index) => `
        <div class="pool-row">
          <strong class="pool-name">${esc(pool.name || `Pool ${index + 1}`)}</strong>
          ${bar(pool.percentUsed)}
          <span class="pool-meta">${esc(bytes(freeFromPool(pool)))} free</span>
          ${badge(pool.status || 'Ready')}
        </div>`).join('') : '<div class="empty">No pool data available</div>'}
    </div>`;
}

function renderNetwork(data) {
  $('#network-card').innerHTML = `
    <div class="card-title"><span>Network</span><span>${esc(display(data.network.interfaces[0] && data.network.interfaces[0].name, 'LAN'))}</span></div>
    <div class="network-layout">
      <div class="speed-grid">
        <div class="speed-card">
          <span class="metric-label">Download</span>
          <div class="speed-value">${bps(data.network.downloadBps)}</div>
        </div>
        <div class="speed-card">
          <span class="metric-label">Upload</span>
          <div class="speed-value">${bps(data.network.uploadBps)}</div>
        </div>
      </div>
      <div class="line-graph" aria-label="Network line graph placeholder">
        <div class="graph-line a"></div>
        <div class="graph-line b"></div>
        <div class="graph-caption">30s sample window</div>
      </div>
    </div>`;
}

function renderDiskHealth(data) {
  const disks = data.diskHealth.disks.slice(0, 4);
  $('#disk-health-card').innerHTML = `
    <div class="card-title"><span>Disk Health</span><span>${esc(display(data.diskHealth.status, 'Unavailable'))}</span></div>
    <div class="disk-grid">
      ${disks.map(disk => {
        const cls = statusClass(disk.status);
        return `
          <div class="disk-tile ${cls === 'ok' ? '' : cls}">
            <div class="disk-name">${esc(display(disk.name, 'Disk'))}</div>
            <div class="disk-size">${esc(display(disk.size, '--'))}</div>
            <div class="disk-status">${badge(disk.status)}</div>
          </div>`;
      }).join('')}
    </div>`;
}

function renderShares(data) {
  const rows = data.shares;
  $('#shares-card').innerHTML = `
    <div class="card-title"><span>Shares</span><span>${data.shares.length || 0} visible</span></div>
    <div class="rows shares-scroll">
      ${rows.length ? rows.map(share => {
        const used = share.percentUsed != null ? pct(share.percentUsed) : display(share.used, '--');
        const free = share.freeBytes != null ? bytes(share.freeBytes) : display(share.free, '--');
        const protocol = share.protocol || share.protocols || share.status || 'SMB';
        return `
          <div class="share-row">
            <strong class="share-name">${esc(display(share.name, 'Share'))}</strong>
            ${bar(share.percentUsed)}
            <span class="share-meta">${esc(used)}</span>
            <span class="share-meta">${esc(free)} ${esc(protocol)}</span>
          </div>`;
      }).join('') : '<div class="empty">No shares visible</div>'}
    </div>`;
  enableTouchScroll($('.shares-scroll'));
}

function enableTouchScroll(el) {
  if (!el) return;
  let lastY = 0;
  el.addEventListener('touchstart', e => {
    if (!e.touches.length) return;
    lastY = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!e.touches.length) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    const y = e.touches[0].clientY;
    const delta = lastY - y;
    const next = Math.max(0, Math.min(max, el.scrollTop + delta));
    if (next !== el.scrollTop) {
      e.preventDefault();
      el.scrollTop = next;
    }
    lastY = y;
  }, { passive: false });
}

function renderServices(data) {
  const rows = data.services.slice(0, 6);
  $('#services-card').innerHTML = `
    <div class="card-title"><span>Services</span><span>${rows.length || 0} tracked</span></div>
    <div class="service-grid">
      ${rows.length ? rows.map(service => {
        const name = typeof service === 'string' ? service : service.name;
        const status = typeof service === 'string' ? 'Running' : service.status || 'Running';
        const cls = statusClass(status);
        return `
          <div class="service-chip">
            <strong class="service-name">${esc(display(name, 'Service'))}</strong>
            <span class="service-status ${cls === 'ok' ? '' : cls}">${esc(display(status, 'Unavailable'))}</span>
          </div>`;
      }).join('') : '<div class="empty">Services unavailable</div>'}
    </div>`;
}

function renderFooter(data) {
  const warning = state.lastError ? `API warning: ${state.lastError}` : '';
  const alerts = data.alerts && data.alerts.length ? data.alerts.join(' | ') : '';
  const health = data.online && !warning && !alerts ? 'System health nominal' : (warning || alerts || 'System health unavailable');
  const cls = data.online && !warning ? 'footer-health' : data.online ? 'footer-health footer-warn' : 'footer-health footer-bad';
  $('#footer').innerHTML = `
    <div class="footer-left">
      <span class="${cls}">${esc(health)}</span>
      <span class="footer-muted">Storage ${pct(data.storage.percentUsed)}</span>
      <span class="footer-muted">CPU ${pct(data.system.cpuPercent)}</span>
      <span class="footer-muted">RAM ${pct(data.system.ramPercent)}</span>
    </div>
    <div class="footer-right">
      <span class="footer-muted" data-last-updated-age>Last updated ${esc(ageText(data.generatedAt))}</span>
      <span class="footer-muted" data-live-clock-time>${esc(dateParts().time)}</span>
      <span class="footer-muted">Auto-refresh ${refreshSeconds}s ${mockMode ? 'Demo' : summaryUrl ? 'Summary' : 'Direct'}</span>
    </div>`;
}

function render(payload) {
  const incoming = normalizeDashboard(payload);
  if (incoming.ok) {
    state.lastGood = payload;
    state.lastError = null;
  } else {
    state.lastError = incoming.error || 'QNAP API unavailable';
  }

  const visiblePayload = incoming.ok
    ? payload
    : payload.lastGood || state.lastGood || payload;
  const data = normalizeDashboard(visiblePayload);
  data.online = incoming.ok && data.online;
  state.visibleGeneratedAt = data.generatedAt;

  document.body.classList.toggle('offline', !incoming.ok);
  renderHeader(data);
  renderSystem(data);
  renderStorageOverview(data);
  renderStoragePools(data);
  renderNetwork(data);
  renderDiskHealth(data);
  renderShares(data);
  renderServices(data);
  renderFooter(data);
  updateLiveTimes();
  startLiveClock();
  finishLoading();
}

function mockData() {
  const now = new Date();
  return {
    ok: true,
    online: true,
    generatedAt: now.toISOString(),
    auth: 'Session OK',
    system: {
      name: 'Open Quake NAS',
      model: 'TS-464-8G',
      firmware: 'QTS 5.2.4 build 20260601',
      uptime: '18d 04h',
      cpuPercent: 32,
      ramPercent: 61,
      statusText: 'Online',
    },
    storage: {
      totalBytes: 32 * 1024 ** 4,
      usedBytes: 19.4 * 1024 ** 4,
      percentUsed: 61,
      pools: [
        { name: 'Pool 1', status: 'Good', percentUsed: 66, totalBytes: 18 * 1024 ** 4, usedBytes: 11.9 * 1024 ** 4 },
        { name: 'Pool 2', status: 'Good', percentUsed: 43, totalBytes: 10 * 1024 ** 4, usedBytes: 4.3 * 1024 ** 4 },
        { name: 'Media Vol', status: 'Warning', percentUsed: 82, totalBytes: 4 * 1024 ** 4, usedBytes: 3.2 * 1024 ** 4 },
      ],
    },
    network: {
      downloadBps: 84 * 1024 ** 2,
      uploadBps: 18 * 1024 ** 2,
      interfaces: [{ name: '2.5GbE LAN 1', status: 'Connected' }],
    },
    diskHealth: {
      status: '3 Good / 1 Warning',
      disks: [
        { name: 'Bay 1', size: '8 TB', status: 'Good' },
        { name: 'Bay 2', size: '8 TB', status: 'Good' },
        { name: 'Bay 3', size: '8 TB', status: 'Good' },
        { name: 'Bay 4', size: '8 TB', status: 'Warning' },
      ],
    },
    shares: [
      { name: 'Backups', percentUsed: 74, freeBytes: 2.1 * 1024 ** 4, protocol: 'SMB' },
      { name: 'Media', percentUsed: 82, freeBytes: 890 * 1024 ** 3, protocol: 'SMB' },
      { name: 'Projects', percentUsed: 48, freeBytes: 3.8 * 1024 ** 4, protocol: 'NFS' },
      { name: 'Public', percentUsed: 21, freeBytes: 1.3 * 1024 ** 4, protocol: 'AFP' },
      { name: 'Container', percentUsed: 36, freeBytes: 740 * 1024 ** 3, protocol: 'SMB' },
      { name: 'Downloads', percentUsed: 57, freeBytes: 1.8 * 1024 ** 4, protocol: 'SMB' },
      { name: 'Archive', percentUsed: 68, freeBytes: 2.6 * 1024 ** 4, protocol: 'NFS' },
      { name: 'Snapshots', percentUsed: 29, freeBytes: 960 * 1024 ** 3, protocol: 'SMB' },
    ],
    recentFiles: [
      { name: 'open-quake-panel.zip', modified: 'Today', sizeBytes: 188 * 1024 ** 2 },
      { name: 'vm-snapshot-0421.img', modified: 'Today', sizeBytes: 31 * 1024 ** 3 },
      { name: 'cad-export.step', modified: 'Sat', sizeBytes: 96 * 1024 ** 2 },
      { name: 'media-index.db', modified: 'Fri', sizeBytes: 640 * 1024 ** 2 },
    ],
    services: [
      { name: 'QTS', status: 'Running' },
      { name: 'File Station', status: 'Running' },
      { name: 'Hybrid Backup', status: 'Connected' },
      { name: 'SMB', status: 'Running' },
      { name: 'NFS', status: 'Running' },
      { name: 'Open Quake', status: 'Connected' },
    ],
    alerts: [],
  };
}

function nowIso() {
  return new Date().toISOString();
}

function asText(value) {
  return value == null || value === '' ? null : String(value);
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
}

function percent(used, total) {
  const u = toNumber(used);
  const t = toNumber(total);
  return !t || u == null ? null : Math.max(0, Math.min(100, Math.round((u / t) * 100)));
}

function textBetween(xml, tag) {
  const re = new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>', 'i');
  const m = re.exec(xml || '');
  return m ? cleanXmlValue(m[1]) : null;
}

function firstXmlValue(xml, tags) {
  for (const tag of tags) {
    const value = textBetween(xml, tag);
    if (value != null && value !== '') return value;
  }
  return null;
}

function cleanXmlValue(value) {
  const text = String(value == null ? '' : value).trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(text);
  return (cdata ? cdata[1] : text).trim();
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function errorSnippet(value) {
  const text = stripTags(value)
    .replace(/(authSid|sid|SID|pwd|plain_pwd|password)\s*[:=]\s*["']?[^"',\s<]+/ig, '$1=<hidden>')
    .slice(0, 180);
  return text ? ': ' + text : '';
}

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null && obj[key] !== '') return obj[key];
  }
  return null;
}

function rowList(value) {
  if (Array.isArray(value)) return value;
  if (!value || value.raw || typeof value !== 'object') return [];
  if (Array.isArray(value.datas)) return value.datas;
  if (Array.isArray(value.children)) return value.children;
  if (Array.isArray(value.volumes)) return value.volumes;
  if (Array.isArray(value.shares)) return value.shares;
  if (value.data && Array.isArray(value.data.datas)) return value.data.datas;
  if (Array.isArray(value.result)) return value.result;
  return [];
}

function unitMultiplier(unit) {
  const u = String(unit || '').toLowerCase();
  if (u === 'pb') return 1024 ** 5;
  if (u === 'tb') return 1024 ** 4;
  if (u === 'gb') return 1024 ** 3;
  if (u === 'mb') return 1024 ** 2;
  if (u === 'kb') return 1024;
  return 1;
}

function sizedValue(row, keys, unitKeys) {
  const value = toNumber(pick(row, keys));
  return value == null ? null : value * unitMultiplier(pick(row, unitKeys || []) || row.volume_unit || row.unit);
}

function base64Utf8(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

async function loadProxyConfig() {
  if (configPromise) return configPromise;
  configPromise = fetch('/app-proxy/config', { cache: 'no-store' })
    .then(res => res.ok ? res.json() : null)
    .then(cfg => {
      const opts = cfg && cfg.options || {};
      qnapHost = String(opts.host || qnapHost || '').replace(/\/+$/, '');
      qnapUser = opts.username || qnapUser || '';
      qnapPass = opts.password || qnapPass || '';
      return opts;
    })
    .catch(() => ({}));
  return configPromise;
}

async function qnapRequest(pathname, params) {
  const url = new URL(pathname, qnapHost);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, value);
  });
  const proxyUrl = '/app-proxy?url=' + encodeURIComponent(url.href);
  const res = await fetch(proxyUrl, {
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = errorSnippet(text);
    if (/^[\s\r\n]*[{[]/.test(text)) {
      try {
        const payload = JSON.parse(text);
        if (payload && payload.error) detail = ': ' + payload.error;
      } catch (e) {}
    }
    const source = res.headers.get('X-Open-Quake-Proxy') === 'error' ? 'proxy' : 'QNAP';
    throw new Error(source + ' returned HTTP ' + res.status + ' for ' + pathname + detail);
  }
  if (/^[\s\r\n]*[{[]/.test(text)) {
    try { return JSON.parse(text); } catch (e) {}
  }
  return { raw: text };
}

function extractSid(body) {
  if (!body) return null;
  if (!body.raw && typeof body === 'object') {
    return body.authSid || body.sid || body.SID || (body.result && (body.result.authSid || body.result.sid)) || null;
  }
  const raw = body.raw || String(body);
  return textBetween(raw, 'authSid') || textBetween(raw, 'sid') || textBetween(raw, 'SID');
}

async function qnapLogin() {
  const encoded = base64Utf8(qnapPass);
  const attempts = [
    { user: qnapUser, pwd: encoded, serviceKey: 1 },
    { user: qnapUser, pwd: encoded },
    { user: qnapUser, plain_pwd: qnapPass, serviceKey: 1 },
    { user: qnapUser, plain_pwd: qnapPass },
  ];
  let lastError = null;
  const errors = [];
  for (const params of attempts) {
    try {
      const body = await qnapRequest('/cgi-bin/authLogin.cgi', params);
      const sid = extractSid(body);
      if (sid) return { sid, body };
      lastError = new Error('QNAP login did not return a session id');
    } catch (e) {
      lastError = e;
      errors.push(e.message);
    }
  }
  if (errors.length) throw new Error('QNAP login failed: ' + errors.slice(-2).join(' | '));
  throw lastError || new Error('QNAP login failed');
}

async function qnapApi(sid, pathname, params) {
  return qnapRequest(pathname, Object.assign({}, params || {}, { sid }));
}

async function firstUsable(sid, candidates, normalizer, test) {
  const errors = [];
  for (const [pathname, params] of candidates) {
    try {
      const value = await qnapApi(sid, pathname, params);
      const normalized = normalizer(value);
      if (test(normalized)) return normalized;
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { _errors: errors };
}

function normalizeSystemApi(body) {
  const raw = body && body.raw ? body.raw : '';
  const data = body && !body.raw ? body : {};
  const nested = data.result || data.data || data.system || data.sysinfo || {};
  const firmwareBlock = raw ? (/<firmware\b[^>]*>([\s\S]*?)<\/firmware>/i.exec(raw) || [])[1] || '' : '';
  const firmwareText = [
    firstXmlValue(firmwareBlock, ['name']),
    firstXmlValue(firmwareBlock, ['version']),
    firstXmlValue(firmwareBlock, ['number']) && 'build ' + firstXmlValue(firmwareBlock, ['number']),
  ].filter(Boolean).join(' ');
  return {
    name: asText(pick(data, ['server_name', 'serverName', 'hostname', 'hostName', 'name']) || pick(nested, ['server_name', 'serverName', 'hostname', 'hostName', 'name']) || textBetween(raw, 'serverName') || textBetween(raw, 'hostname')),
    model: asText(pick(data, ['displayModelName', 'display_model', 'model', 'modelName']) || pick(nested, ['displayModelName', 'display_model', 'model', 'modelName']) || textBetween(raw, 'displayModelName') || textBetween(raw, 'modelName') || textBetween(raw, 'model')),
    firmware: asText(pick(data, ['firmware', 'version', 'fw_version', 'firmwareVersion']) || pick(nested, ['firmware', 'version', 'fw_version', 'firmwareVersion']) || firmwareText || textBetween(raw, 'firmwareVersion')),
    uptime: asText(pick(data, ['uptime', 'up_time']) || pick(nested, ['uptime', 'up_time']) || textBetween(raw, 'uptime')),
    cpuPercent: toNumber(pick(data, ['cpu_usage', 'cpu_usage_percent', 'cpuUsage', 'cpu_percent']) || pick(nested, ['cpu_usage', 'cpu_usage_percent', 'cpuUsage', 'cpu_percent']) || firstXmlValue(raw, ['cpu_usage', 'cpu_usage_percent', 'cpuUsage', 'cpu_percent'])),
    ramPercent: toNumber(pick(data, ['mem_usage', 'memory_usage', 'ram_usage', 'memUsage', 'ram_percent', 'memory_percent']) || pick(nested, ['mem_usage', 'memory_usage', 'ram_usage', 'memUsage', 'ram_percent', 'memory_percent']) || firstXmlValue(raw, ['mem_usage', 'memory_usage', 'ram_usage', 'memUsage', 'ram_percent', 'memory_percent'])),
    statusText: 'Online',
  };
}

function normalizeResourcesApi(body) {
  const raw = body && body.raw ? body.raw : '';
  const data = body && !body.raw ? body : {};
  return {
    cpuPercent: toNumber(pick(data, ['cpu_usage', 'cpu_usage_percent', 'cpuUsage', 'cpu_percent']) || firstXmlValue(raw, ['cpu_usage', 'cpu_usage_percent', 'cpuUsage', 'cpu_percent'])),
    ramPercent: toNumber(pick(data, ['mem_usage', 'memory_usage', 'ram_usage', 'memUsage', 'ram_percent', 'memory_percent']) || firstXmlValue(raw, ['mem_usage', 'memory_usage', 'ram_usage', 'memUsage', 'ram_percent', 'memory_percent'])),
    network: {
      downloadBps: toNumber(pick(data, ['downloadBytesPerSecond', 'rxBytesSec', 'rx_rate', 'rxRate', 'download_rate', 'down']) || firstXmlValue(raw, ['downloadBytesPerSecond', 'rxBytesSec', 'rx_rate', 'rxRate', 'download_rate', 'down'])),
      uploadBps: toNumber(pick(data, ['uploadBytesPerSecond', 'txBytesSec', 'tx_rate', 'txRate', 'upload_rate', 'up']) || firstXmlValue(raw, ['uploadBytesPerSecond', 'txBytesSec', 'tx_rate', 'txRate', 'upload_rate', 'up'])),
      interfaces: [],
    },
  };
}

function normalizeStorageApi(body) {
  const raw = body && body.raw ? body.raw : '';
  const data = body && !body.raw ? body : {};
  const rows = rowList(data);
  let used = sizedValue(data, ['used_size', 'used', 'total_used', 'usedSize']);
  let total = sizedValue(data, ['total_size', 'total', 'capacity', 'size']);
  const pools = rows.slice(0, 6).map((row, i) => {
    const size = sizedValue(row, ['total_size', 'total', 'capacity', 'size', 'total_bytes', 'totalByte']);
    let rowUsed = sizedValue(row, ['used_size', 'used', 'usedSize', 'used_bytes', 'usedByte']);
    const free = sizedValue(row, ['free_size', 'free', 'available', 'available_size', 'free_bytes', 'freeByte']);
    if (rowUsed == null && size != null && free != null) rowUsed = size - free;
    if (rowUsed != null) used = (used || 0) + rowUsed;
    if (size != null) total = (total || 0) + size;
    return {
      name: asText(row.name || row.label || row.vol_label || row.filename || row.text || row.volume_label || row.volume_name || row.mount_path) || 'Pool ' + (i + 1),
      status: asText(row.status || row.health || row.vol_status || row.volume_status || row.volume_avail) || 'N/A',
      percentUsed: percent(rowUsed, size),
      totalBytes: size,
      usedBytes: rowUsed,
    };
  }).filter(row => row.percentUsed != null || row.totalBytes != null);
  if (used == null) used = toNumber(textBetween(raw, 'used_size'));
  if (total == null) total = toNumber(textBetween(raw, 'total_size'));
  return { usedBytes: total ? used : null, totalBytes: total || null, percentUsed: percent(used, total), pools };
}

function normalizeSharesApi(body) {
  return rowList(body).slice(0, 8).map(row => ({
    name: asText(row.filename || row.name || row.text || row.label || row.share_name) || 'Share',
    status: row.isfolder === 0 ? 'File' : asText(row.status) || 'Ready',
  }));
}

async function fetchQnapDirectSummary() {
  const res = await fetch('/app-api/summary', { cache: 'no-store' });
  const text = await res.text();
  if (!res.ok) {
    let detail = errorSnippet(text);
    if (/^[\s\r\n]*[{[]/.test(text)) {
      try {
        const payload = JSON.parse(text);
        if (payload && payload.error) detail = ': ' + payload.error;
      } catch (e) {}
    }
    throw new Error('QNAP server adapter returned HTTP ' + res.status + detail);
  }
  return JSON.parse(text);
}

async function refresh() {
  try {
    if (!state.lastGood) setLoadingStatus(mockMode ? 'Preparing demo data' : summaryUrl ? 'Loading summary feed' : 'Connecting to NAS');
    if (mockMode) {
      render(mockData());
      return;
    }
    if (summaryUrl) {
      const res = await fetch(summaryUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error('Summary endpoint returned HTTP ' + res.status);
      render(await res.json());
      return;
    }
    render(await fetchQnapDirectSummary());
  } catch (e) {
    render({
      ok: false,
      error: e.message || 'QNAP API unavailable',
      generatedAt: new Date().toISOString(),
      lastGood: state.lastGood,
    });
  } finally {
    clearTimeout(state.timer);
    state.nextRefresh = Date.now() + REFRESH_MS;
    state.timer = setTimeout(refresh, REFRESH_MS);
  }
}

refresh();
