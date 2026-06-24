'use strict';

const { shell } = require('electron');

const DEFAULT_FEEDS = [
  { id: 'hn', name: 'HN', url: 'https://hnrss.org/frontpage', category: 'DEV', enabled: true, maxItems: 10 },
  { id: 'github', name: 'GitHub', url: 'https://github.blog/feed/', category: 'REL', enabled: true, maxItems: 10 },
  { id: 'openai', name: 'OpenAI', url: 'https://openai.com/news/rss.xml', category: 'AI', enabled: true, maxItems: 10 },
];

async function handle(action, context) {
  if (action === 'open') return openExternal(context && context.query && context.query.url);
  if (action !== 'feeds') return { ok: false, error: 'unknown action' };

  const config = configuredFeeds(context && context.options || {});
  const enabled = config.feeds.filter(feed => feed.enabled !== false && feed.url);
  if (!enabled.length) return { ok: true, items: [], errors: config.errors.concat([{ sourceName: 'SYSTEM', message: 'No enabled feeds configured' }]) };

  const results = await Promise.all(enabled.map(loadFeed));
  const items = [];
  const errors = config.errors.slice();
  const seen = new Set();

  results.forEach(result => {
    if (result.error) errors.push(result.error);
    result.items.forEach(item => {
      const key = item.link || item.title;
      if (!key || seen.has(key)) return;
      seen.add(key);
      items.push(item);
    });
  });

  items.sort((a, b) => timestamp(b.publishedAt) - timestamp(a.publishedAt));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    items,
    errors,
  };
}

async function openExternal(url) {
  let target;
  try {
    target = new URL(String(url || ''));
  } catch (error) {
    return { ok: false, error: 'invalid url' };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return { ok: false, error: 'unsupported protocol' };
  await shell.openExternal(target.href);
  return { ok: true };
}

function configuredFeeds(options) {
  const raw = options.feedsJson;
  if (!raw) return { feeds: DEFAULT_FEEDS, errors: [] };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('RSS feeds JSON must be an array');
    return {
      feeds: parsed.map((feed, index) => normalizeFeed(feed, index)).filter(Boolean),
      errors: [],
    };
  } catch (error) {
    return {
      feeds: [],
      errors: [{ sourceName: 'CONFIG', message: error.message || 'RSS feeds JSON is invalid' }],
    };
  }
}

function normalizeFeed(feed, index) {
  if (!feed || typeof feed !== 'object') return null;
  const id = safeToken(feed.id || feed.name || `feed-${index + 1}`, `feed-${index + 1}`).toLowerCase();
  return {
    id,
    name: safeToken(feed.name || id, id).slice(0, 24),
    url: String(feed.url || '').trim(),
    category: safeToken(feed.category || 'NEWS', 'NEWS').slice(0, 16),
    enabled: feed.enabled !== false && feed.enabled !== 'false',
    maxItems: Math.max(1, Math.min(50, parseInt(feed.maxItems, 10) || 10)),
  };
}

async function loadFeed(feed) {
  try {
    const url = new URL(feed.url);
    if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https RSS URLs are supported');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(url.href, {
        signal: controller.signal,
        headers: {
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
          'User-Agent': 'open-quake-split-flap-rss',
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    const xml = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const parsed = parseFeedXml(xml, feed).slice(0, feed.maxItems);
    return { items: parsed, error: null };
  } catch (error) {
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
  const rssItems = blocks(xml, 'item');
  const atomItems = rssItems.length ? [] : blocks(xml, 'entry');
  const rows = rssItems.length ? rssItems : atomItems;

  return rows.map((block, index) => {
    const title = decodeXml(textOf(block, 'title') || 'Untitled');
    const link = decodeXml(linkOf(block) || textOf(block, 'guid') || feed.url);
    const publishedAt = dateOf(block);
    return {
      id: `${feed.id}:${hash(link || title || String(index))}`,
      sourceId: feed.id,
      sourceName: feed.name,
      category: feed.category,
      title,
      link,
      publishedAt,
    };
  }).filter(item => item.title);
}

function blocks(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const found = [];
  let match;
  while ((match = re.exec(xml || ''))) found.push(match[1]);
  return found;
}

function textOf(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = re.exec(xml || '');
  return match ? stripCdata(match[1]).trim() : '';
}

function linkOf(xml) {
  const atom = /<link\b[^>]*href=["']([^"']+)["'][^>]*>/i.exec(xml || '');
  if (atom) return atom[1];
  return textOf(xml, 'link');
}

function dateOf(xml) {
  const raw = textOf(xml, 'pubDate') || textOf(xml, 'published') || textOf(xml, 'updated') || textOf(xml, 'dc:date');
  const date = raw ? new Date(decodeXml(raw)) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function stripCdata(value) {
  const text = String(value == null ? '' : value).trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(text);
  return cdata ? cdata[1] : text;
}

function decodeXml(value) {
  return stripCdata(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (m, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function safeToken(value, fallback) {
  const text = String(value == null ? '' : value).trim();
  return text ? text.replace(/[^\w -]/g, '').replace(/\s+/g, ' ') : fallback;
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

module.exports = { handle };
