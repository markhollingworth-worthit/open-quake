'use strict';
/*
 * haschedule.js — data source for the "HA Schedule" dev app. Pulls 6 agenda + 6 event input_text
 * helpers from Home Assistant in ONE /api/template call and parses them into structured rows. [dev, MIT]
 *
 * Credentials come from settings.haAuth (Settings → Auth in the editor), handed in via configure()
 * by main.js. The token never reaches the panel page — main fetches, sysserver serves only the
 * parsed snapshot, same-origin.
 *
 *   agenda line:  06/24|10:00 AM|AAA sprinklerworks here   ->  date | time | title
 *   event  line:  Rivoli|The Matrix|Fri|7:00 PM            ->  venue | title | day | time
 */
const { net } = require('electron');

const IDS = [1, 2, 3, 4, 5, 6];
// One template render returns all 12 helper states as JSON (HA's |tojson), so it's a single round-trip.
const TEMPLATE = "{{ {'agenda':["
  + IDS.map(i => `states('input_text.agenda_line_${i}')`).join(',')
  + "],'events':["
  + IDS.map(i => `states('input_text.event_line_${i}')`).join(',')
  + "]} | tojson }}";

let baseUrl = '', token = '';
let snapshot = { agenda: [], events: [], ok: false, ts: 0 };
let timer = null, running = false, busy = false, curMs = 0;

function configure(opts) {
  baseUrl = ((opts && opts.url) || '').replace(/\/+$/, '');
  token = (opts && opts.token) || '';
}

function blank(s) { return s == null || s === '' || s === 'unknown' || s === 'unavailable'; }
function parseAgenda(s) { if (blank(s)) return null; const p = String(s).split('|'); return { date: (p[0] || '').trim(), time: (p[1] || '').trim(), title: p.slice(2).join('|').trim() }; }
function parseEvent(s) { if (blank(s)) return null; const p = String(s).split('|'); return { venue: (p[0] || '').trim(), title: (p[1] || '').trim(), day: (p[2] || '').trim(), time: p.slice(3).join('|').trim() }; }

// Chronological sort, soonest first. The `day` field is mixed: a date range ("6/16-6/25") keys off its
// start date; weekday names ("Fri Sat") key off the next upcoming occurrence; anything unparseable sinks
// to the bottom keeping its original order (stable via the captured index).
const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function parseClock(s) {
  const m = String(s || '').match(/(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/);
  if (!m) return null;
  let h = parseInt(m[1], 10); const min = parseInt(m[2], 10); const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return { h, m: min };
}
function eventSortKey(e) {
  const now = new Date();
  const day = (e.day || '').trim();
  let base = null;
  const md = day.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);               // leading M/D → start date, this year
  if (md) {
    base = new Date(now.getFullYear(), parseInt(md[1], 10) - 1, parseInt(md[2], 10));
  } else {                                                          // earliest weekday name → next occurrence
    const lower = day.toLowerCase(); let bestDelta = null;
    for (const k in DOW) {
      if (lower.indexOf(k) !== -1) { const d = (DOW[k] - now.getDay() + 7) % 7; if (bestDelta === null || d < bestDelta) bestDelta = d; }
    }
    if (bestDelta !== null) base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + bestDelta);
  }
  if (!base) return Infinity;
  const t = parseClock(e.time); if (t) base.setHours(t.h, t.m, 0, 0);
  return base.getTime();
}
function sortEvents(arr) {
  return arr.map((e, i) => [eventSortKey(e), i, e])
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
    .map((x) => x[2]);
}

async function poll() {
  if (!baseUrl || !token) { snapshot = { agenda: [], events: [], ok: false, ts: Date.now(), error: 'missing HA URL / token — set them in Settings → Auth' }; return; }
  try {
    const r = await net.fetch(baseUrl + '/api/template', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: TEMPLATE }),
    });
    if (!r.ok) { snapshot = { agenda: [], events: [], ok: false, ts: Date.now(), error: 'HA ' + r.status }; return; }
    const data = JSON.parse(await r.text());
    snapshot = {
      agenda: (data.agenda || []).map(parseAgenda).filter(Boolean),
      events: sortEvents((data.events || []).map(parseEvent).filter(Boolean)),
      ok: true, ts: Date.now(),
    };
  } catch (e) { snapshot = { agenda: [], events: [], ok: false, ts: Date.now(), error: String(e && e.message || e) }; }
}

function tick() { if (busy || !running) return; busy = true; poll().finally(() => { busy = false; }); }
// start() is idempotent for an unchanged interval; a changed interval (the app option) restarts the timer.
function start(intervalMs) {
  const ms = Math.max(15000, intervalMs || 600000);
  if (running && ms === curMs) return;
  stop();
  running = true; curMs = ms; tick(); timer = setInterval(tick, ms);
}
function stop() { running = false; if (timer) clearInterval(timer); timer = null; }
function getSnapshot() { return snapshot; }

module.exports = { configure, start, stop, getSnapshot };
