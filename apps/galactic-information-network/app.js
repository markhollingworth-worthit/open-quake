'use strict';

const params = new URLSearchParams(location.search || location.hash.replace(/^#/, ''));

const settings = {
  mode: selectValue(params.get('mode'), ['elite', 'mixed', 'custom', 'demo'], 'demo'),
  rotationSeconds: clampInt(params.get('rotationSeconds'), 30, 60, 45),
  showTicker: boolValue(params.get('showTicker'), true),
  showMap: boolValue(params.get('showMap'), true),
  showTransmissionScreen: boolValue(params.get('showTransmissionScreen'), true),
  enableAmbientMode: boolValue(params.get('enableAmbientMode'), true),
  maxTickerItems: clampInt(params.get('maxTickerItems'), 8, 50, 50),
  rssFeeds: parseFeeds(params.get('rssFeeds')),
};

const elements = {
  feedMode: document.getElementById('feedMode'),
  sourceCount: document.getElementById('sourceCount'),
  signalStatus: document.getElementById('signalStatus'),
  lastRefresh: document.getElementById('lastRefresh'),
  qualityBars: document.getElementById('qualityBars'),
  mapPanel: document.getElementById('mapPanel'),
  mainGrid: document.querySelector('.main-grid'),
  galaxyMap: document.getElementById('galaxyMap'),
  routeLabel: document.getElementById('routeLabel'),
  incoming: document.getElementById('incoming'),
  incomingSource: document.getElementById('incomingSource'),
  incomingCategory: document.getElementById('incomingCategory'),
  articleContent: document.getElementById('articleContent'),
  articleSource: document.getElementById('articleSource'),
  articleCategory: document.getElementById('articleCategory'),
  articleAge: document.getElementById('articleAge'),
  headline: document.getElementById('headline'),
  summary: document.getElementById('summary'),
  tickerBand: document.getElementById('tickerBand'),
  tickerTrack: document.getElementById('tickerTrack'),
};

const systems = [
  ['Sol', 122, 156], ['Achenar', 208, 235], ['Alioth', 258, 118], ['Lave', 320, 178],
  ['Leesti', 366, 216], ['Diso', 424, 174], ['Eravate', 188, 88], ['Deciat', 470, 116],
  ['Shinrarta Dezhra', 528, 196], ['Colonia', 610, 80], ['Sagittarius A*', 588, 258],
  ['Maia', 92, 246], ['Merope', 152, 288], ['Aegis Reach', 276, 282], ['Tionisla', 398, 86],
  ['Zaonce', 346, 136], ['Rhea', 540, 54], ['Cubeo', 650, 142], ['Gateway', 224, 184],
  ['Quince', 114, 78], ['Dromi', 78, 178], ['Ngurii', 466, 258], ['Kremainn', 302, 56],
  ['Orion Spur', 670, 246], ['Eurybia', 426, 288], ['Canopus', 42, 106]
].map(([name, x, y]) => ({ name, x, y }));

const routes = [
  ['Sol', 'Achenar'], ['Sol', 'Alioth'], ['Sol', 'Eravate'], ['Sol', 'Dromi'],
  ['Achenar', 'Gateway'], ['Gateway', 'Lave'], ['Lave', 'Leesti'], ['Leesti', 'Diso'],
  ['Diso', 'Deciat'], ['Deciat', 'Shinrarta Dezhra'], ['Shinrarta Dezhra', 'Sagittarius A*'],
  ['Sagittarius A*', 'Colonia'], ['Colonia', 'Rhea'], ['Rhea', 'Cubeo'], ['Cubeo', 'Orion Spur'],
  ['Maia', 'Merope'], ['Merope', 'Aegis Reach'], ['Aegis Reach', 'Eurybia'], ['Eurybia', 'Ngurii'],
  ['Tionisla', 'Zaonce'], ['Zaonce', 'Lave'], ['Kremainn', 'Alioth'], ['Canopus', 'Quince'],
  ['Quince', 'Eravate'], ['Ngurii', 'Sagittarius A*']
];

const eliteArticles = [
  article('Shinrarta Dezhra', 'TECHNOLOGY', 'Pilots Federation Issues Long Range Scanner Calibration',
    'Engineers report a revised sensor profile for deep-space traffic corridors. Commanders are advised to recalibrate before entering high-density relay lanes.', -12),
  article('Merope', 'THARGOID ACTIVITY', 'Aegis Patrols Track Unusual Wake Signatures Near Maia',
    'Recon flights have logged intermittent non-human signal sources across the Pleiades. Civilian haulers are being routed through guarded approach vectors.', -31),
  article('Alioth', 'POLITICS', 'Alliance Assembly Debates Expansion Charter',
    'Delegates from frontier systems are reviewing a revised charter intended to stabilize trade access without reducing local system autonomy.', -44),
  article('Colonia', 'EXPLORATION', 'Colonia Cartographers Publish Outer Arm Survey Window',
    'Independent explorers are being asked to submit high-resolution scans from sparse regions beyond the coreward routes.', -61),
  article('Deciat', 'ENGINEERING', 'Workshop Congestion Reported at Deciat Approach',
    'Traffic control has activated queue routing for engineering-bound vessels after a surge in module upgrade requests.', -83),
  article('Lave', 'COMMERCE', 'Old Worlds Trade Compact Opens New Agri-Medicine Corridor',
    'Merchant guilds from Lave, Leesti, and Diso have approved a rapid transit route for agricultural medicines and emergency supplies.', -100),
  article('Sagittarius A*', 'RESEARCH', 'Core Expedition Returns With Magnetar Telemetry',
    'A fleet of deep-range science vessels has transmitted compression-mapped telemetry from the galactic core.', -127),
  article('Achenar', 'POWERPLAY', 'Imperial Logistics Bureau Announces Security Drill',
    'Passenger hubs across the Achenar sphere will stage a synchronized customs and convoy response exercise over the next cycle.', -145),
  article('Sol', 'COMMUNITY GOAL', 'Pilots Federation Opens Civil Engineering Contract',
    'Licensed commanders are requested to deliver structural composites and power regulators for orbital habitat repairs.', -163),
  article('Merope', 'SECURITY ALERT', 'Convoy Advisory Issued for Pleiades Supply Routes',
    'Escort wings are reporting intermittent interdiction attempts near known salvage sites. Traders should maintain wing telemetry.', -188)
];

const ambientArticles = [
  article('Zaonce', 'SYSTEMS', 'Station Profile: Ridley Scott Orbital Maintains Legacy Docking Array',
    'Technicians at Zaonce report that heritage docking systems remain operational after a careful relay timing overhaul.', -220),
  article('Rhea', 'GOVERNMENT', 'Regional Administrators Review Relief Stockpiles',
    'Local authorities are auditing life-support reserves and shelter capacity ahead of the next heavy traffic period.', -242),
  article('Orion Spur', 'EXPLORATION', 'Survey Guild Highlights Uncatalogued Ice Worlds',
    'Recent exploration packets point to a chain of dim ice worlds suitable for long-baseline observatory placement.', -260),
  article('Cubeo', 'ENTERTAINMENT', 'Imperial Broadcast Season Opens With Zero-G Ballet',
    'Cultural relays are carrying a live performance recorded in a rotating amphitheater above Cubeo III.', -281),
  article('Gateway', 'COMMERCE', 'Trade Route Forecast Favors Machinery and Medicines',
    'Broker terminals are showing increased demand for industrial components, basic medicines, and refinery spares.', -310)
];

const categoryMap = [
  [/ai|artificial intelligence|machine learning/i, 'TECHNOLOGY'],
  [/technology|software|hardware|computing|gadget/i, 'TECHNOLOGY'],
  [/programming|developer|code|open source/i, 'SYSTEMS'],
  [/business|finance|market|economy|earnings/i, 'COMMERCE'],
  [/science|research|physics|biology|climate/i, 'RESEARCH'],
  [/space|nasa|esa|rocket|telescope|astronomy/i, 'EXPLORATION'],
  [/gaming|game|games|xbox|playstation|nintendo/i, 'ENTERTAINMENT'],
  [/sports|football|baseball|racing/i, 'RECREATIONAL BROADCAST'],
  [/security|vulnerability|malware|breach|hack/i, 'SECURITY ALERT'],
  [/politics|government|election|policy/i, 'GOVERNMENT']
];

const state = {
  articles: [],
  currentIndex: 0,
  routeFrom: 'Sol',
  routeTo: 'Alioth',
  timers: [],
  sourceCount: 24,
  errors: []
};

function clampInt(value, min, max, fallback) {
  const number = parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function boolValue(value, fallback) {
  if (value == null || value === '') return fallback;
  return value === true || value === 'true' || value === '1' || value === 1;
}

function selectValue(value, choices, fallback) {
  return choices.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : fallback;
}

function parseFeeds(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry, index) => {
      if (typeof entry === 'string') return { url: entry, name: hostName(entry), category: '', weight: 1 };
      return {
        url: String(entry.url || ''),
        name: String(entry.name || hostName(entry.url) || `Feed ${index + 1}`),
        category: String(entry.category || ''),
        weight: Number(entry.weight || 1)
      };
    }).filter(feed => /^https?:\/\//i.test(feed.url));
  } catch (e) {
    return [];
  }
}

function article(source, category, title, summary, minutesAgo) {
  const publishedAt = new Date(Date.now() + minutesAgo * 60000).toISOString();
  return { source, category, title, summary, publishedAt, feedSource: 'GIN Relay' };
}

function hostName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

function cleanText(value) {
  const text = String(value || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return text || 'Transmission summary unavailable from source packet.';
}

function init() {
  elements.feedMode.textContent = settings.mode.toUpperCase();
  elements.tickerBand.classList.toggle('hidden', !settings.showTicker);
  elements.mapPanel.classList.toggle('hidden', !settings.showMap);
  elements.mainGrid.classList.toggle('no-map', !settings.showMap);
  buildMap();
  loadArticles();
  setInterval(updateClock, 15000);
}

async function loadArticles() {
  const base = settings.mode === 'mixed' ? weightedEliteArticles() : eliteArticles.slice();
  const shouldLoadFeeds = settings.mode === 'mixed' || settings.mode === 'custom';
  let feedArticles = [];

  if (settings.mode === 'demo') {
    state.articles = base.concat(ambientArticles);
  } else {
    if (shouldLoadFeeds && settings.rssFeeds.length) {
      feedArticles = await loadRssFeeds(settings.rssFeeds);
    }
    if (settings.mode === 'custom') {
      state.articles = feedArticles;
    } else if (settings.mode === 'mixed') {
      state.articles = base.concat(feedArticles);
    } else {
      state.articles = base;
    }
    if (!state.articles.length && settings.enableAmbientMode) {
      state.articles = ambientArticles.slice();
    }
  }

  if (settings.enableAmbientMode && state.articles.length < 6) {
    state.articles = state.articles.concat(ambientArticles);
  }

  state.sourceCount = Math.max(1, new Set(state.articles.map(item => item.feedSource || item.source)).size);
  elements.sourceCount.textContent = String(state.sourceCount);
  elements.signalStatus.textContent = state.errors.length ? 'DEGRADED' : 'STABLE';
  elements.qualityBars.textContent = state.errors.length ? '██████░░░░' : '████████░░';
  updateClock();
  renderTicker();
  showArticle(0, false);
  startRotation();
}

function weightedEliteArticles() {
  return eliteArticles.concat(eliteArticles.slice(0, Math.ceil(eliteArticles.length / 2)));
}

async function loadRssFeeds(feeds) {
  const batches = await Promise.allSettled(feeds.map(feed => loadRssFeed(feed)));
  const articles = [];
  state.errors = [];
  batches.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      articles.push(...result.value);
    } else {
      state.errors.push({ feed: feeds[index].name, error: result.reason && result.reason.message });
    }
  });
  return articles
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 45);
}

async function loadRssFeed(feed) {
  const url = `/app-proxy?url=${encodeURIComponent(feed.url)}&accept=${encodeURIComponent('application/rss+xml, application/xml, text/xml, */*')}&timeout=9000`;
  const response = await fetch(url, { cache: 'no-store' });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('Invalid XML');

  const rssItems = Array.from(doc.querySelectorAll('item'));
  const atomItems = Array.from(doc.querySelectorAll('entry'));
  const nodes = rssItems.length ? rssItems : atomItems;

  return nodes.slice(0, 12).map((node, index) => {
    const title = textFrom(node, ['title']) || 'Untitled transmission';
    const summary = textFrom(node, ['description', 'summary', 'content']) || title;
    const publishedAt = textFrom(node, ['pubDate', 'published', 'updated']) || new Date(Date.now() - index * 900000).toISOString();
    const source = assignSystem(title + ' ' + summary);
    const category = feed.category ? feed.category.toUpperCase() : translateCategory(title + ' ' + summary);
    return {
      source,
      category,
      title: cleanText(title),
      summary: trimSummary(cleanText(summary)),
      publishedAt,
      feedSource: feed.name || hostName(feed.url),
      link: textFrom(node, ['link'])
    };
  });
}

function textFrom(node, names) {
  for (const name of names) {
    const found = node.getElementsByTagName(name)[0];
    if (!found) continue;
    if (name === 'link' && found.getAttribute('href')) return found.getAttribute('href');
    const text = found.textContent || '';
    if (text.trim()) return text.trim();
  }
  return '';
}

function translateCategory(text) {
  const match = categoryMap.find(([pattern]) => pattern.test(text));
  return match ? match[1] : 'GENERAL TRANSMISSION';
}

function assignSystem(seedText) {
  const preferred = systems.find(system => new RegExp(`\\b${escapeRegExp(system.name)}\\b`, 'i').test(seedText));
  if (preferred) return preferred.name;
  let hash = 0;
  for (let i = 0; i < seedText.length; i += 1) {
    hash = (hash * 31 + seedText.charCodeAt(i)) >>> 0;
  }
  return systems[hash % systems.length].name;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimSummary(text) {
  if (text.length <= 235) return text;
  const trimmed = text.slice(0, 232);
  return trimmed.slice(0, Math.max(120, trimmed.lastIndexOf(' '))) + '...';
}

function buildMap() {
  const svg = elements.galaxyMap;
  svg.replaceChildren();
  const ns = 'http://www.w3.org/2000/svg';

  for (let x = 40; x <= 680; x += 80) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', x);
    line.setAttribute('x2', x);
    line.setAttribute('y1', 36);
    line.setAttribute('y2', 306);
    line.setAttribute('class', 'map-grid');
    svg.appendChild(line);
  }
  for (let y = 48; y <= 304; y += 64) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', 24);
    line.setAttribute('x2', 696);
    line.setAttribute('y1', y);
    line.setAttribute('y2', y);
    line.setAttribute('class', 'map-grid');
    svg.appendChild(line);
  }

  routes.forEach(([from, to]) => {
    const a = systemByName(from);
    const b = systemByName(to);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', routePath(a, b));
    path.setAttribute('class', 'route');
    path.dataset.from = from;
    path.dataset.to = to;
    svg.appendChild(path);
  });

  systems.forEach(system => {
    const group = document.createElementNS(ns, 'g');
    group.dataset.system = system.name;

    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', system.x);
    dot.setAttribute('cy', system.y);
    dot.setAttribute('r', system.name.length > 10 ? 5.4 : 4.5);
    dot.setAttribute('class', 'star-dot');

    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', system.x + 9);
    label.setAttribute('y', system.y - 8);
    label.setAttribute('class', system.name.length > 10 ? 'star-label dim' : 'star-label');
    label.textContent = system.name.toUpperCase();

    group.append(dot, label);
    svg.appendChild(group);
  });
}

function routePath(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const bend = Math.max(-38, Math.min(38, (dx - dy) / 7));
  const cx = (a.x + b.x) / 2 + bend;
  const cy = (a.y + b.y) / 2 - bend;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

function systemByName(name) {
  return systems.find(system => system.name === name) || systems[0];
}

function startRotation() {
  clearTimers();
  const delay = settings.rotationSeconds * 1000;
  state.timers.push(setInterval(() => {
    const next = (state.currentIndex + 1) % state.articles.length;
    showArticle(next, true);
  }, delay));
}

function clearTimers() {
  state.timers.forEach(timer => clearInterval(timer));
  state.timers = [];
}

function showArticle(index, animate) {
  if (!state.articles.length) return;
  const item = state.articles[index % state.articles.length];
  const previous = state.articles[state.currentIndex] || item;
  state.currentIndex = index % state.articles.length;
  state.routeFrom = previous.source || state.routeFrom;
  state.routeTo = item.source || assignSystem(item.title);
  animateRoute(state.routeFrom, state.routeTo);

  if (!animate) {
    renderArticle(item);
    return;
  }

  elements.articleContent.classList.add('fading');
  if (settings.showTransmissionScreen) {
    elements.incomingSource.textContent = `SOURCE: ${item.source.toUpperCase()}`;
    elements.incomingCategory.textContent = `CATEGORY: ${item.category.toUpperCase()}`;
    elements.incoming.classList.remove('hidden');
  }

  setTimeout(() => {
    renderArticle(item);
    elements.articleContent.classList.remove('fading');
  }, settings.showTransmissionScreen ? 1800 : 420);

  setTimeout(() => {
    elements.incoming.classList.add('hidden');
  }, settings.showTransmissionScreen ? 2400 : 600);
}

function renderArticle(item) {
  elements.articleSource.textContent = `SOURCE: ${item.source.toUpperCase()}`;
  elements.articleCategory.textContent = `CATEGORY: ${item.category.toUpperCase()}`;
  elements.articleAge.textContent = `RECEIVED ${relativeAge(item.publishedAt).toUpperCase()}`;
  elements.headline.textContent = item.title;
  elements.summary.textContent = item.summary;
}

function animateRoute(from, to) {
  const route = findRoute(from, to);
  elements.routeLabel.textContent = `${from} -> ${to}`.toUpperCase();
  document.querySelectorAll('.route').forEach(path => path.classList.remove('active'));
  document.querySelectorAll('.star-dot').forEach(dot => dot.classList.remove('active', 'destination'));

  const sourceGroup = document.querySelector(`g[data-system="${cssEscape(from)}"] .star-dot`);
  const destGroup = document.querySelector(`g[data-system="${cssEscape(to)}"] .star-dot`);
  if (sourceGroup) sourceGroup.classList.add('active');
  if (destGroup) destGroup.classList.add('destination');
  if (route) {
    route.classList.remove('active');
    void route.getBoundingClientRect();
    route.classList.add('active');
  }
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}

function findRoute(from, to) {
  return Array.from(document.querySelectorAll('.route')).find(path => {
    return (path.dataset.from === from && path.dataset.to === to) || (path.dataset.from === to && path.dataset.to === from);
  }) || nearestRoute(to);
}

function nearestRoute(to) {
  return Array.from(document.querySelectorAll('.route')).find(path => path.dataset.to === to || path.dataset.from === to);
}

function renderTicker() {
  const items = state.articles.slice(0, settings.maxTickerItems);
  const row = items.map(item => {
    const span = document.createElement('span');
    span.className = 'ticker-item';
    span.innerHTML = `<b>${escapeHtml(item.category)}</b> ${escapeHtml(item.title)}`;
    return span;
  });
  elements.tickerTrack.replaceChildren(...row, ...row.map(node => node.cloneNode(true)));
  requestAnimationFrame(syncTickerSpeed);
}

function syncTickerSpeed() {
  const loopDistance = elements.tickerTrack.scrollWidth / 2;
  const viewportWidth = elements.tickerBand.clientWidth || 1920;
  const targetPixelsPerSecond = 95;
  const duration = Math.max(42, Math.min(180, (loopDistance + viewportWidth) / targetPixelsPerSecond));
  elements.tickerTrack.style.setProperty('--ticker-duration', `${duration.toFixed(1)}s`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function updateClock() {
  elements.lastRefresh.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function relativeAge(value) {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return 'moments ago';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return 'moments ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

init();
