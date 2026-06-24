'use strict';

const params = new URLSearchParams(location.search);

const DEFAULT_FEEDS = [
  { id: 'bbc', name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml', category: 'World', priority: 1, enabled: true, maxItems: 18 },
  { id: 'sky', name: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/home.xml', category: 'Top Stories', priority: 2, enabled: true, maxItems: 18 },
  { id: 'verge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'Technology', priority: 3, enabled: true, maxItems: 14 },
  { id: 'nasa', name: 'NASA', url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss', category: 'Science', priority: 4, enabled: true, maxItems: 10 },
];

const LIVE_STREAM_SOURCES = [
  {
    id: 'euronews',
    name: 'Euronews Live',
    provider: 'iframe',
    url: 'https://www.euronews.com/live',
    enabled: true,
  },
  {
    id: 'dw-news',
    name: 'DW News Live',
    provider: 'iframe',
    url: 'https://www.dw.com/en/live-tv/s-100825',
    enabled: true,
  },
  {
    id: 'france24',
    name: 'France 24 Live',
    provider: 'iframe',
    url: 'https://www.france24.com/en/live',
    enabled: true,
  },
];

const SOURCE_COLORS = [
  { pattern: /\bbbc\b/i, color: '#e51b2b' },
  { pattern: /\bsky\b/i, color: '#0072ce' },
  { pattern: /\breuters\b/i, color: '#ff8a18' },
  { pattern: /\bcnn\b/i, color: '#cc0000' },
  { pattern: /\bverge\b/i, color: '#fa4b8b' },
  { pattern: /\bnasa\b/i, color: '#2d7dd2' },
  { pattern: /\bars\b/i, color: '#ff4e00' },
  { pattern: /\bassociated press\b|\bap\b/i, color: '#ff322e' },
];

const settings = {
  mode: oneOf(params.get('mode'), ['live-video', 'spotlight', 'wall', 'full-tv'], 'live-video'),
  theme: oneOf(params.get('theme'), ['open-quake', 'bbc', 'bloomberg', 'reuters', 'financial'], 'open-quake'),
  liveStream: selectedLiveStream(params.get('liveStream')),
  rssFeeds: parseFeeds(params.get('rssFeeds'), DEFAULT_FEEDS),
  tickerFeeds: parseFeeds(params.get('tickerFeeds'), null),
  showTicker: readBool(params.get('showTicker'), true),
  showLiveFeed: readBool(params.get('showLiveFeed'), true),
  showSummary: readBool(params.get('showSummary'), true),
  showPublishedTime: readBool(params.get('showPublishedTime'), true),
  showSource: readBool(params.get('showSource'), true),
  showCategory: readBool(params.get('showCategory'), true),
  enableBreakingNews: readBool(params.get('enableBreakingNews'), true),
  enableStoryRotation: readBool(params.get('enableStoryRotation'), true),
  storyDuration: clampNumber(params.get('storyDuration'), 10, 60, 15),
  refreshIntervalMinutes: clampNumber(params.get('refreshIntervalMinutes'), 1, 240, 5),
};

const els = {
  app: document.getElementById('app'),
  videoFrame: document.getElementById('videoFrame'),
  videoMount: document.getElementById('videoMount'),
  videoFallback: document.getElementById('videoFallback'),
  fallbackKicker: document.getElementById('fallbackKicker'),
  fallbackHeadline: document.getElementById('fallbackHeadline'),
  fallbackSummary: document.getElementById('fallbackSummary'),
  sourceBadge: document.getElementById('sourceBadge'),
  timeBadge: document.getElementById('timeBadge'),
  railTitle: document.getElementById('railTitle'),
  updateStatus: document.getElementById('updateStatus'),
  breakingBanner: document.getElementById('breakingBanner'),
  feedList: document.getElementById('feedList'),
  spotlightImageA: document.getElementById('spotlightImageA'),
  spotlightImageB: document.getElementById('spotlightImageB'),
  spotlightMeta: document.getElementById('spotlightMeta'),
  spotlightHeadline: document.getElementById('spotlightHeadline'),
  spotlightSummary: document.getElementById('spotlightSummary'),
  wallGrid: document.getElementById('wallGrid'),
  ticker: document.getElementById('ticker'),
  tickerTrack: document.getElementById('tickerTrack'),
  emptyState: document.getElementById('emptyState'),
  emptyDetails: document.getElementById('emptyDetails'),
};

const state = {
  stories: [],
  tickerStories: [],
  errors: [],
  index: 0,
  activeSpotlightImage: 0,
  rotateTimer: null,
  refreshTimer: null,
  clockTimer: null,
  lastRefreshAt: null,
  videoUnavailable: false,
};

init();

function init() {
  document.documentElement.style.setProperty('--story-seconds', `${settings.storyDuration}s`);
  els.app.className = `channel theme-${settings.theme} mode-${settings.mode}`;
  els.app.classList.toggle('no-ticker', !settings.showTicker);
  els.app.classList.toggle('hide-rail', !settings.showLiveFeed);
  els.railTitle.textContent = settings.liveStream.name || 'Live News';
  els.sourceBadge.textContent = settings.liveStream.name || 'Open-Quake News';

  renderVideo(settings.liveStream);
  renderRailStatus('Loading live headlines', 'Connecting to configured RSS feeds.');
  renderTicker();
  tickClock();
  state.clockTimer = setInterval(tickClock, 1000);
  refreshFeeds();
}

async function renderVideo(source) {
  els.videoMount.textContent = '';
  els.videoFrame.classList.remove('video-ready');
  state.videoUnavailable = false;

  if (!source || !source.enabled || !source.url) {
    showVideoUnavailable();
    return;
  }

  const url = safeUrl(source.url);
  if (!url) {
    showVideoUnavailable();
    return;
  }

  if (source.provider === 'iframe') {
    const frame = document.createElement('iframe');
    frame.src = url;
    frame.title = source.name || 'Live video';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.loading = 'eager';
    frame.addEventListener('load', () => els.videoFrame.classList.add('video-ready'), { once: true });
    frame.addEventListener('error', showVideoUnavailable, { once: true });
    els.videoMount.append(frame);
    window.setTimeout(() => {
      if (!els.videoFrame.classList.contains('video-ready')) showVideoUnavailable();
    }, 10000);
    return;
  }

  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.controls = false;
  video.loop = source.provider === 'mp4';
  video.addEventListener('playing', () => els.videoFrame.classList.add('video-ready'));
  video.addEventListener('error', showVideoUnavailable);
  els.videoMount.append(video);

  if (source.provider === 'hls' && await attachHls(video, url)) return;

  video.src = url;
  video.play().catch(showVideoUnavailable);
}

async function refreshFeeds() {
  const feeds = settings.rssFeeds.filter(feed => feed.enabled && feed.url);
  if (!feeds.length) {
    state.errors = [{ sourceName: 'CONFIG', message: 'No enabled feeds configured' }];
    renderEmpty();
    scheduleRefresh();
    return;
  }

  const results = await Promise.all(feeds.map(loadFeed));
  const stories = [];
  const errors = [];
  const seen = new Set();

  results.forEach(result => {
    if (result.error) errors.push(result.error);
    result.items.forEach(item => {
      const duplicateKey = storyKey(item);
      if (!duplicateKey || seen.has(duplicateKey)) return;
      seen.add(duplicateKey);
      stories.push(item);
    });
  });

  stories.sort(compareStories);
  state.errors = errors;
  state.lastRefreshAt = new Date();

  if (stories.length) {
    state.stories = stories;
    state.tickerStories = await tickerStories(stories);
    state.index = Math.min(state.index, Math.max(0, stories.length - 1));
    renderAll();
    startRotation();
  } else if (!state.stories.length) {
    renderEmpty();
  }

  scheduleRefresh();
}

async function tickerStories(primaryStories) {
  const feeds = (settings.tickerFeeds || []).filter(feed => feed.enabled && feed.url);
  if (!feeds.length) return primaryStories;

  const results = await Promise.all(feeds.map(loadFeed));
  const stories = [];
  results.forEach(result => result.items.forEach(item => stories.push(item)));
  stories.sort(compareStories);
  return stories.length ? stories : primaryStories;
}

async function loadFeed(feed) {
  try {
    const response = await fetchWithTimeout(`/app-proxy?url=${encodeURIComponent(feed.url)}`, {
      cache: 'no-store',
    }, 15000);
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const items = parseFeedText(text, feed).slice(0, feed.maxItems);
    if (!items.length) throw new Error('No feed items found');
    await enrichMissingImages(items);
    return { items, error: null };
  } catch (error) {
    console.warn(`News Channel feed failed: ${feed.name}`, error);
    return {
      items: [],
      error: {
        sourceId: feed.id,
        sourceName: feed.name,
        message: error.message || 'Feed failed to load',
      },
    };
  }
}

function parseFeedXml(xml, feed) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid RSS XML');

  const rssRows = Array.from(doc.querySelectorAll('item'));
  const atomRows = rssRows.length ? [] : Array.from(doc.querySelectorAll('entry'));
  const rows = rssRows.length ? rssRows : atomRows;

  return rows.map((node, index) => {
    const title = cleanText(textOf(node, 'title') || 'Untitled');
    const link = linkOf(node) || textOf(node, 'guid') || feed.url;
    const summary = cleanText(textOf(node, 'description') || textOf(node, 'summary') || textOf(node, 'content\\:encoded') || title);
    const publishedAt = dateOf(node);
    const image = imageOf(node, feed.url) || feed.defaultImage || '';
    const category = cleanText(textOf(node, 'category') || feed.category || 'News');
    const breaking = /\b(breaking|alert|urgent|developing|live updates?)\b/i.test(`${title} ${summary}`);

    return {
      id: `${feed.id}:${hash(link || title || String(index))}`,
      sourceId: feed.id,
      sourceName: feed.name,
      category,
      title,
      summary,
      link,
      publishedAt,
      image,
      priority: feed.priority,
      weight: feed.weight,
      breaking,
      accent: sourceColor(feed.name),
    };
  }).filter(item => item.title);
}

function renderAll() {
  els.emptyState.hidden = true;
  const current = state.stories[state.index] || state.stories[0];
  renderFallbackStory(current);
  renderRail();
  renderSpotlight(current);
  renderWall();
  renderTicker();
  renderStatus();
}

function renderFallbackStory(story) {
  if (state.videoUnavailable) {
    els.fallbackKicker.textContent = 'Stream Offline';
    els.fallbackHeadline.textContent = 'Live stream unavailable';
    els.fallbackSummary.textContent = story && settings.showSummary
      ? story.summary
      : 'Headlines and ticker remain live.';
    return;
  }
  if (!story) return;
  els.fallbackHeadline.textContent = story.title;
  els.fallbackSummary.textContent = settings.showSummary ? story.summary : '';
}

function renderRail() {
  const items = state.stories.slice(0, visibleRailCount());
  if (!items.length) {
    renderRailStatus('No live headlines', emptyStatusText());
    return;
  }

  els.feedList.replaceChildren(...items.map((story, index) => {
    const item = document.createElement('article');
    item.className = 'feed-item';
    item.style.setProperty('--item-accent', story.accent);
    item.style.animationDelay = `${index * 56}ms`;

    const meta = document.createElement('p');
    meta.className = 'feed-meta';
    meta.textContent = metaLine(story);

    const heading = document.createElement('h2');
    heading.textContent = story.title;

    const summary = document.createElement('p');
    summary.textContent = settings.showSummary ? story.summary : '';

    item.append(meta, heading, summary);
    return item;
  }));

  els.breakingBanner.hidden = !(settings.enableBreakingNews && state.stories.some(story => story.breaking));
}

function renderSpotlight(story) {
  if (!story) return;
  els.spotlightMeta.textContent = metaLine(story);
  els.spotlightHeadline.textContent = story.title;
  els.spotlightSummary.textContent = settings.showSummary ? story.summary : '';
  updateSpotlightImage(story);
}

function renderWall() {
  const items = state.stories.slice(0, 6);
  els.wallGrid.replaceChildren(...items.map(story => {
    const article = document.createElement('article');
    article.className = 'wall-story';
    article.style.setProperty('--item-accent', story.accent);
    if (story.image) {
      article.classList.add('has-image');
      article.style.backgroundImage = `url("${cssUrl(proxiedAssetUrl(story.image))}")`;
    }

    const meta = document.createElement('p');
    meta.className = 'wall-meta';
    meta.textContent = metaLine(story);

    const heading = document.createElement('h2');
    heading.textContent = story.title;

    const summary = document.createElement('p');
    summary.textContent = settings.showSummary ? story.summary : '';

    article.append(meta, heading, summary);
    return article;
  }));
}

function renderTicker() {
  if (!settings.showTicker) return;
  const stories = state.tickerStories.length ? state.tickerStories : state.stories;
  const chunks = stories.slice(0, 24).map(story => {
    const source = settings.showSource ? `${escapeHtml(story.sourceName)}: ` : '';
    return `<b>${escapeHtml(source)}</b>${escapeHtml(story.title)}`;
  });
  const content = chunks.length ? chunks.join(' <span aria-hidden="true">•</span> ') : 'Awaiting headlines from configured feeds';
  els.tickerTrack.innerHTML = `<span>Breaking</span>${content}<span>Breaking</span>${content}`;
  updateTickerDuration();
}

function renderStatus() {
  const errors = state.errors.length;
  const time = state.lastRefreshAt ? formatTime(state.lastRefreshAt.toISOString()) : 'pending';
  els.updateStatus.textContent = errors ? `${errors} issue${errors === 1 ? '' : 's'}` : time;
}

function renderEmpty() {
  clearInterval(state.rotateTimer);
  els.emptyState.hidden = settings.mode === 'live-video' || settings.mode === 'full-tv';
  els.emptyDetails.textContent = emptyStatusText();
  els.updateStatus.textContent = 'No stories';
  renderRailStatus('Headlines unavailable', emptyStatusText());
  renderTicker();
}

function renderRailStatus(title, summary) {
  const item = document.createElement('article');
  item.className = 'feed-item status';
  item.style.setProperty('--item-accent', 'var(--accent)');

  const meta = document.createElement('p');
  meta.className = 'feed-meta';
  meta.textContent = 'Live News';

  const heading = document.createElement('h2');
  heading.textContent = title;

  const body = document.createElement('p');
  body.textContent = summary;

  item.append(meta, heading, body);
  els.feedList.replaceChildren(item);
  els.breakingBanner.hidden = true;
}

function updateSpotlightImage(story) {
  const current = state.activeSpotlightImage === 0 ? els.spotlightImageA : els.spotlightImageB;
  const next = state.activeSpotlightImage === 0 ? els.spotlightImageB : els.spotlightImageA;

  next.onerror = () => applyImageFallback(next, story);
  if (story.image) {
    next.removeAttribute('style');
    next.src = proxiedAssetUrl(story.image);
  } else {
    applyImageFallback(next, story);
  }

  next.classList.add('active');
  current.classList.remove('active');
  state.activeSpotlightImage = state.activeSpotlightImage === 0 ? 1 : 0;
  preloadNextImage();
}

function applyImageFallback(img, story) {
  img.removeAttribute('src');
  img.onerror = null;
  img.style.background = categoryBackdrop(story && story.category);
}

function startRotation() {
  clearInterval(state.rotateTimer);
  if (!settings.enableStoryRotation || state.stories.length < 2) return;
  state.rotateTimer = setInterval(() => {
    state.index = (state.index + 1) % state.stories.length;
    renderAll();
  }, settings.storyDuration * 1000);
}

function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(refreshFeeds, settings.refreshIntervalMinutes * 60 * 1000);
}

function showVideoUnavailable() {
  state.videoUnavailable = true;
  els.videoFrame.classList.remove('video-ready');
  els.videoMount.textContent = '';
  els.fallbackKicker.textContent = 'Stream Offline';
  els.fallbackHeadline.textContent = 'Live stream unavailable';
  els.fallbackSummary.textContent = 'Headlines and ticker remain live.';
}

function safeUrl(source) {
  try {
    const url = new URL(String(source || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch (error) {
    return '';
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function enrichMissingImages(items) {
  const queue = items.filter(item => !item.image && isHttpUrl(item.link)).slice(0, 10);
  const workers = [0, 1, 2].map(async workerIndex => {
    for (let index = workerIndex; index < queue.length; index += 3) {
      const item = queue[index];
      const image = await articleImage(item.link);
      if (image) item.image = image;
    }
  });
  await Promise.all(workers);
}

async function articleImage(url) {
  try {
    const response = await fetchWithTimeout(`/app-proxy?url=${encodeURIComponent(url)}`, {
      cache: 'no-store',
    }, 9000);
    const html = await response.text();
    if (!response.ok) return '';
    return imageFromHtml(html, url);
  } catch (error) {
    return '';
  }
}

async function attachHls(video, url) {
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    video.play().catch(showVideoUnavailable);
    return true;
  }

  try {
    await loadScript('https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js');
    if (!window.Hls || !window.Hls.isSupported()) return false;
    const hls = new window.Hls({ lowLatencyMode: true, backBufferLength: 45 });
    hls.on(window.Hls.Events.ERROR, (event, data) => {
      if (data && data.fatal) showVideoUnavailable();
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    video.play().catch(showVideoUnavailable);
    return true;
  } catch (error) {
    console.warn('News Channel HLS helper failed:', error);
    return false;
  }
}

function loadScript(src) {
  const existing = Array.from(document.scripts).find(script => script.dataset.newsChannelSrc === src);
  if (existing) {
    return existing.dataset.loaded === 'true'
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
      });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.newsChannelSrc = src;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', reject, { once: true });
    document.head.append(script);
  });
}

function selectedLiveStream(id) {
  const enabled = LIVE_STREAM_SOURCES.filter(source => source.enabled);
  const selected = enabled.find(source => source.id === id) || enabled[0];
  return selected || { id: 'none', name: 'Live News', provider: 'iframe', url: '', enabled: false };
}

function parseFeedText(text, feed) {
  try {
    return parseFeedXml(text, feed);
  } catch (error) {
    const htmlItems = parseHtmlFeed(text, feed);
    if (htmlItems.length) return htmlItems;
    throw error;
  }
}

function parseFeeds(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('feeds must be an array');
    const feeds = parsed.map(normalizeFeed).filter(Boolean);
    return feeds.length ? feeds : fallback;
  } catch (error) {
    console.warn('News Channel feed configuration failed:', error);
    return fallback;
  }
}

function parseHtmlFeed(html, feed) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = Array.from(doc.querySelectorAll('article, li, h2, h3')).slice(0, feed.maxItems * 2);
  const seen = new Set();
  const items = [];

  rows.forEach((node, index) => {
    const linkNode = node.matches('a[href]') ? node : node.querySelector('a[href]');
    const title = cleanText((linkNode && linkNode.textContent) || node.textContent || '');
    if (!title || title.length < 12 || seen.has(title)) return;
    seen.add(title);
    const link = resolveUrl(linkNode && linkNode.getAttribute('href'), feed.url) || feed.url;
    items.push({
      id: `${feed.id}:html:${hash(link || title || String(index))}`,
      sourceId: feed.id,
      sourceName: feed.name,
      category: feed.category,
      title,
      summary: title,
      link,
      publishedAt: new Date().toISOString(),
      image: htmlImageOf(node, feed.url),
      priority: feed.priority,
      weight: feed.weight,
      breaking: /\b(breaking|alert|urgent|developing|live updates?)\b/i.test(title),
      accent: sourceColor(feed.name),
    });
  });

  return items.slice(0, feed.maxItems);
}

function resolveUrl(value, baseUrl) {
  if (!value) return '';
  try {
    return new URL(value, baseUrl).href;
  } catch (error) {
    return '';
  }
}

function normalizeFeed(feed, index) {
  if (typeof feed === 'string') {
    return {
      id: `feed-${index + 1}`,
      name: hostName(feed),
      url: feed,
      category: 'News',
      priority: index + 1,
      weight: 1,
      enabled: true,
      maxItems: 20,
      defaultImage: '',
    };
  }

  if (!feed || typeof feed !== 'object' || !feed.url) return null;
  return {
    id: cleanText(feed.id || feed.name || `feed-${index + 1}`).toLowerCase().replace(/[^a-z0-9-]+/g, '-') || `feed-${index + 1}`,
    name: cleanText(feed.name || hostName(feed.url) || `Feed ${index + 1}`),
    url: String(feed.url || '').trim(),
    category: cleanText(feed.category || 'News'),
    priority: clampNumber(feed.priority, 1, 999, index + 1),
    weight: clampNumber(feed.weight, 1, 10, 1),
    enabled: feed.enabled !== false && feed.enabled !== 'false',
    maxItems: clampNumber(feed.maxItems, 1, 60, 20),
    defaultImage: String(feed.defaultImage || '').trim(),
  };
}

function textOf(node, selector) {
  const found = node.querySelector(selector);
  return found ? decodeHtml(found.textContent || '') : '';
}

function linkOf(node) {
  const atom = node.querySelector('link[href]');
  if (atom) return atom.getAttribute('href') || '';
  return textOf(node, 'link');
}

function dateOf(node) {
  const raw = textOf(node, 'pubDate') || textOf(node, 'published') || textOf(node, 'updated') || textOf(node, 'dc\\:date');
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function imageOf(node, baseUrl) {
  const selectors = [
    'media\\:content[url]',
    'media\\:thumbnail[url]',
    'enclosure[url][type^="image"]',
    'image url',
  ];

  for (const selector of selectors) {
    const found = node.querySelector(selector);
    if (!found) continue;
    const url = found.getAttribute('url') || found.textContent;
    const resolved = resolveImageUrl(url, baseUrl);
    if (resolved) return resolved;
  }

  const namespaced = [
    ...Array.from(node.getElementsByTagNameNS('*', 'content')),
    ...Array.from(node.getElementsByTagNameNS('*', 'thumbnail')),
  ];
  for (const found of namespaced) {
    const resolved = resolveImageUrl(found.getAttribute('url'), baseUrl);
    if (resolved) return resolved;
  }

  const html = rawHtmlOf(node, 'description') || rawHtmlOf(node, 'content\\:encoded');
  return imageFromHtml(html, baseUrl);
}

function imageFromHtml(html, baseUrl) {
  const source = String(html || '');
  const metaPatterns = [
    /<meta\b[^>]*(?:property|name)=["']og:image(?::url)?["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta\b[^>]*(?:property|name)=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image(?::url)?["'][^>]*>/i,
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']twitter:image(?::src)?["'][^>]*>/i,
  ];

  for (const pattern of metaPatterns) {
    const match = pattern.exec(source);
    const resolved = resolveImageUrl(match && match[1], baseUrl);
    if (resolved) return resolved;
  }

  const imgMatch = /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(source);
  return resolveImageUrl(imgMatch && imgMatch[1], baseUrl);
}

function htmlImageOf(node, baseUrl) {
  const image = node.querySelector('img[src], source[srcset], img[srcset]');
  if (!image) return '';
  const srcset = image.getAttribute('srcset');
  if (srcset) {
    const first = srcset.split(',').map(part => part.trim().split(/\s+/)[0]).find(Boolean);
    const resolved = resolveImageUrl(first, baseUrl);
    if (resolved) return resolved;
  }
  return resolveImageUrl(image.getAttribute('src'), baseUrl);
}

function resolveImageUrl(value, baseUrl) {
  const cleaned = decodeHtml(value || '').trim();
  if (!cleaned || cleaned.startsWith('data:')) return '';
  if (isHttpUrl(cleaned)) return cleaned;
  return resolveUrl(cleaned, baseUrl);
}

function proxiedAssetUrl(url) {
  return isHttpUrl(url) ? `/app-proxy?url=${encodeURIComponent(url)}` : url;
}

function metaLine(story) {
  const chunks = [];
  if (settings.showSource && story.sourceName) chunks.push(story.sourceName);
  if (settings.showCategory && story.category) chunks.push(story.category);
  if (settings.showPublishedTime && story.publishedAt) chunks.push(formatTime(story.publishedAt));
  return chunks.join(' / ') || 'Live News';
}

function visibleRailCount() {
  const height = window.innerHeight || 480;
  if (height < 380) return 4;
  if (height < 520) return 5;
  return 7;
}

function updateTickerDuration() {
  window.requestAnimationFrame(() => {
    const distance = Math.max(els.tickerTrack.scrollWidth / 2, window.innerWidth);
    const seconds = Math.max(120, Math.min(300, Math.round(distance / 26)));
    els.tickerTrack.style.setProperty('--ticker-duration', `${seconds}s`);
  });
}

function tickClock() {
  els.timeBadge.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function preloadNextImage() {
  if (state.stories.length < 2) return;
  const next = state.stories[(state.index + 1) % state.stories.length];
  if (!next || !next.image) return;
  const img = new Image();
  img.decoding = 'async';
  img.src = proxiedAssetUrl(next.image);
}

function compareStories(a, b) {
  const breakingDelta = Number(Boolean(b.breaking)) - Number(Boolean(a.breaking));
  if (settings.enableBreakingNews && breakingDelta) return breakingDelta;
  const freshDelta = freshnessScore(b) - freshnessScore(a);
  if (freshDelta) return freshDelta;
  const priorityDelta = a.priority - b.priority;
  if (priorityDelta) return priorityDelta;
  return timestamp(b.publishedAt) - timestamp(a.publishedAt);
}

function freshnessScore(story) {
  const ageHours = Math.max(0, (Date.now() - timestamp(story.publishedAt)) / 3600000);
  return (story.weight * 1000) - (ageHours * 8) - (story.priority * 4);
}

function storyKey(story) {
  return (story.link || story.title || '').toLowerCase().replace(/[?#].*$/, '').replace(/\s+/g, ' ').trim();
}

function emptyStatusText() {
  const feedCount = settings.rssFeeds.filter(feed => feed.enabled).length;
  const issueCount = state.errors.length;
  if (!feedCount) return 'No enabled RSS feeds are configured.';
  if (issueCount) return `${feedCount} feeds configured. ${issueCount} feed issue${issueCount === 1 ? '' : 's'} reported.`;
  return `${feedCount} feeds configured. Waiting for the first refresh.`;
}

function sourceColor(sourceName) {
  const match = SOURCE_COLORS.find(entry => entry.pattern.test(sourceName || ''));
  if (match) return match.color;
  const palette = ['#26a7ff', '#23c777', '#f5b544', '#e85d75', '#9a87ff', '#45c4d8'];
  return palette[Math.abs(hash(sourceName || 'news').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % palette.length];
}

function categoryBackdrop(category) {
  const text = String(category || '').toLowerCase();
  if (text.includes('business')) return 'linear-gradient(135deg, #121923, #334250 58%, #c9a35a)';
  if (text.includes('science')) return 'linear-gradient(135deg, #061d25, #175462 58%, #70d6e3)';
  if (text.includes('sport')) return 'linear-gradient(135deg, #0b1f18, #236b44 58%, #d7f58a)';
  if (text.includes('tech')) return 'linear-gradient(135deg, #081525, #1b446d 58%, #8dc8ff)';
  return 'linear-gradient(135deg, #10141d, #2d3746 58%, #dce4ef)';
}

function formatTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  if (diffMs >= 0 && diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}m ago`;
  if (diffMs >= 0 && diffMs < 8 * hour) return `${Math.floor(diffMs / hour)}h ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function rawHtmlOf(node, selector) {
  const found = node.querySelector(selector);
  return found ? found.innerHTML || found.textContent || '' : '';
}

function decodeHtml(value) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(value == null ? '' : value);
  return textarea.value;
}

function cleanText(value) {
  return decodeHtml(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cssUrl(value) {
  return String(value || '').replace(/["\\]/g, '\\$&');
}

function hostName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (error) {
    return 'RSS Feed';
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function readBool(value, fallback) {
  if (value == null || value === '') return fallback;
  return value === true || value === 'true' || value === '1';
}

function timestamp(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function hash(value) {
  let h = 5381;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(36);
}
