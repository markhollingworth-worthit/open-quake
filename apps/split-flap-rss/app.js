'use strict';

const params = new URLSearchParams(location.search);
const settings = {
  rows: clampInt(params.get('rows'), 1, 12, 6),
  columns: clampInt(params.get('columns'), 40, 64, 64),
  refreshSeconds: clampInt(params.get('refreshSeconds'), 30, 3600, 300),
  rotateSeconds: clampInt(params.get('rotateSeconds'), 5, 300, 15),
};

const board = document.getElementById('board');
const state = {
  items: [],
  errors: [],
  offset: 0,
  refreshTimer: null,
  rotateTimer: null,
  lastLines: [],
  tiles: [],
  animationTimers: [],
};

const FLAP_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-./';

function clampInt(value, min, max, fallback) {
  const number = parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function buildBoard() {
  document.documentElement.style.setProperty('--rows', String(settings.rows));
  document.documentElement.style.setProperty('--columns', String(settings.columns));
  board.replaceChildren();
  state.tiles = [];

  for (let rowIndex = 0; rowIndex < settings.rows; rowIndex += 1) {
    const row = document.createElement('div');
    row.className = 'board-row';
    row.setAttribute('role', 'text');
    row.addEventListener('click', openRowLink);
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openRowLink(event);
      }
    });
    const rowTiles = [];

    for (let colIndex = 0; colIndex < settings.columns; colIndex += 1) {
      const tile = document.createElement('span');
      tile.className = 'tile space';
      tile.dataset.char = ' ';
      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      glyph.textContent = ' ';
      tile.appendChild(glyph);
      row.appendChild(tile);
      rowTiles.push(tile);
    }

    board.appendChild(row);
    state.tiles.push(rowTiles);
  }
}

function apiUrl(action) {
  return `/app-api/${action}`;
}

async function loadFeeds() {
  renderStatus('SYSTEM', 'INFO', 'LOADING RSS FEEDS...');
  try {
    const response = await fetch(apiUrl('feeds'), { cache: 'no-store' });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (e) {
      payload = { ok: false, error: 'Invalid RSS response' };
    }
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `RSS loader returned HTTP ${response.status}`);

    state.items = Array.isArray(payload.items) ? payload.items : [];
    state.errors = Array.isArray(payload.errors) ? payload.errors : [];
    state.offset = 0;
    renderCurrentBatch();
  } catch (error) {
    state.items = [];
    state.errors = [{ sourceName: 'RSS', message: error.message || 'Feed refresh failed' }];
    renderCurrentBatch();
  } finally {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(loadFeeds, settings.refreshSeconds * 1000);
  }
}

function startRotation() {
  clearInterval(state.rotateTimer);
  state.rotateTimer = setInterval(() => {
    if (state.items.length > settings.rows) {
      state.offset = (state.offset + settings.rows) % state.items.length;
    }
    renderCurrentBatch();
  }, settings.rotateSeconds * 1000);
}

function renderStatus(source, category, title) {
  const line = formatLine({
    sourceName: source,
    category,
    title: `${category} ${title}`,
    publishedAt: new Date().toISOString(),
  });
  const lines = [line].concat(Array(Math.max(0, settings.rows - 1)).fill(''));
  renderLines(lines, category === 'ERROR' ? 'error' : category === 'WARN' ? 'warn' : '', []);
}

function renderCurrentBatch() {
  const lines = [];
  const classes = [];
  const links = [];

  if (!state.items.length) {
    if (state.errors.length) {
      state.errors.slice(0, settings.rows).forEach(error => {
        lines.push(formatLine({
          sourceName: 'SYSTEM',
          category: 'ERROR',
          title: `ERROR FEED FAILED TO LOAD: ${error.sourceName || error.sourceId || 'RSS'}`,
          publishedAt: new Date().toISOString(),
        }));
        classes.push('error');
        links.push('');
      });
    }
    if (!lines.length) {
      lines.push(formatLine({
        sourceName: 'SYSTEM',
        category: 'WARN',
        title: 'WARN NO RSS ITEMS AVAILABLE',
        publishedAt: new Date().toISOString(),
      }));
      classes.push('warn');
      links.push('');
    }
  } else {
    visibleItems().forEach(item => {
      lines.push(formatLine(item));
      classes.push('');
      links.push(item.link || '');
    });

    state.errors.slice(0, Math.max(0, settings.rows - lines.length)).forEach(error => {
      lines.push(formatLine({
        sourceName: 'SYSTEM',
        category: 'ERROR',
        title: `ERROR FEED FAILED TO LOAD: ${error.sourceName || error.sourceId || 'RSS'}`,
        publishedAt: new Date().toISOString(),
      }));
      classes.push('error');
      links.push('');
    });
  }

  while (lines.length < settings.rows) {
    lines.push(formatLine({
      sourceName: 'SYSTEM',
      category: 'INFO',
      title: ' ',
      publishedAt: '',
    }));
    classes.push('');
    links.push('');
  }

  renderLines(lines.slice(0, settings.rows), classes, links);
}

function visibleItems() {
  if (state.items.length <= settings.rows) return state.items.slice(0, settings.rows);
  const rows = [];
  for (let index = 0; index < settings.rows; index += 1) {
    rows.push(state.items[(state.offset + index) % state.items.length]);
  }
  return rows;
}

function formatLine(item) {
  return titleField(item.title || '', settings.columns).slice(0, settings.columns).padEnd(settings.columns, ' ');
}

function fixed(value, width) {
  const text = cleanTitle(value).slice(0, width).toUpperCase();
  return text.padEnd(width, ' ');
}

function titleField(value, width) {
  const text = cleanTitle(value).toUpperCase();
  if (text.length <= width) return text.padEnd(width, ' ');

  const words = text.split(' ');
  let output = '';
  for (const word of words) {
    const next = output ? `${output} ${word}` : word;
    if (next.length > width) break;
    output = next;
  }

  if (!output) output = words[0].slice(0, width);
  return output.padEnd(width, ' ');
}

function cleanTitle(value) {
  return String(value == null ? '' : value)
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function renderLines(lines, rowClasses, rowLinks) {
  clearAnimationTimers();
  lines.forEach((line, rowIndex) => {
    const padded = line.padEnd(settings.columns, ' ').slice(0, settings.columns);
    const rowClass = Array.isArray(rowClasses) ? rowClasses[rowIndex] || '' : rowClasses || '';
    const oldLine = state.lastLines[rowIndex] || ''.padEnd(settings.columns, ' ');
    const row = board.children[rowIndex];
    const link = Array.isArray(rowLinks) ? rowLinks[rowIndex] || '' : '';
    if (link) {
      row.dataset.link = link;
      row.tabIndex = 0;
      row.setAttribute('role', 'link');
      row.setAttribute('aria-label', `Open article: ${padded.trim()}`);
    } else {
      delete row.dataset.link;
      row.removeAttribute('tabindex');
      row.setAttribute('role', 'text');
      row.removeAttribute('aria-label');
    }

    for (let colIndex = 0; colIndex < settings.columns; colIndex += 1) {
      const char = padded[colIndex] || ' ';
      const tile = state.tiles[rowIndex][colIndex];
      tile.classList.toggle('space', char === ' ');
      tile.classList.toggle('warn', rowClass === 'warn');
      tile.classList.toggle('error', rowClass === 'error');

      if (oldLine[colIndex] !== char || tile.dataset.char !== char) {
        scheduleTileSettle(tile, char, rowIndex, colIndex);
      }
    }

    state.lastLines[rowIndex] = padded;
  });
}

async function openRowLink(event) {
  const row = event.currentTarget;
  const link = row && row.dataset.link;
  if (!link) return;
  try {
    const response = await fetch(`/app-api/open?url=${encodeURIComponent(link)}`, { cache: 'no-store' });
    if (response.ok) return;
  } catch (e) {}
  window.open(link, '_blank', 'noopener');
}

function clearAnimationTimers() {
  state.animationTimers.forEach(timer => clearTimeout(timer));
  state.animationTimers = [];
  state.tiles.flat().forEach(tile => {
    if (tile._spinTimer) clearInterval(tile._spinTimer);
    tile._spinTimer = null;
    tile.classList.remove('spooling');
  });
}

function scheduleTileSettle(tile, targetChar, rowIndex, colIndex) {
  const startDelay = colIndex * 18 + rowIndex * 32;
  const spinMs = 150 + Math.floor(Math.random() * 90);
  const glyph = tile.querySelector('.glyph');

  const timer = setTimeout(() => {
    tile.classList.add('spooling');
    tile.classList.remove('flip');
    if (tile._spinTimer) clearInterval(tile._spinTimer);
    tile._spinTimer = setInterval(() => {
      glyph.textContent = FLAP_CHARS[Math.floor(Math.random() * FLAP_CHARS.length)];
      tile.classList.remove('space');
    }, 28);

    const settleTimer = setTimeout(() => {
      if (tile._spinTimer) clearInterval(tile._spinTimer);
      tile._spinTimer = null;
      tile.dataset.char = targetChar;
      glyph.textContent = targetChar === ' ' ? ' ' : targetChar;
      tile.classList.toggle('space', targetChar === ' ');
      tile.classList.remove('spooling');
      tile.style.setProperty('--flip-duration', `${360 + Math.floor(Math.random() * 120)}ms`);
      tile.classList.remove('flip');
      void tile.offsetWidth;
      tile.classList.add('flip');
    }, spinMs);

    state.animationTimers.push(settleTimer);
  }, startDelay);

  state.animationTimers.push(timer);
}

buildBoard();
startRotation();
loadFeeds();
