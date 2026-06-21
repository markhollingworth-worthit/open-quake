'use strict';

const http = require('http');
const https = require('https');

function nowIso() { return new Date().toISOString(); }
function asText(value) { return value == null || value === '' ? null : String(value); }
function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function percent(used, total) {
  const u = toNumber(used);
  const t = toNumber(total);
  if (!t || u == null) return null;
  return Math.max(0, Math.min(100, Math.round((u / t) * 100)));
}
function textBetween(xml, tag) {
  const re = new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>', 'i');
  const m = re.exec(xml || '');
  if (!m) return null;
  return cleanXmlValue(m[1]);
}
function allBlocks(xml, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'ig');
  let m;
  while ((m = re.exec(xml || ''))) out.push(m[1]);
  return out;
}
function firstBlock(xml, tag) {
  return allBlocks(xml, tag)[0] || '';
}
function nestedBlock(xml, tags) {
  return tags.reduce((block, tag) => firstBlock(block, tag) || '', xml || '');
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
function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null && obj[key] !== '') return obj[key];
  return null;
}
function hasAny(obj, keys) {
  return !!obj && typeof obj === 'object' && keys.some(key => Object.prototype.hasOwnProperty.call(obj, key));
}
function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, '').trim();
}
function bodySnippet(value) {
  return stripTags(value || '')
    .replace(/(authSid|sid|SID)\s*[:=]\s*["']?[^"',\s<]+/g, '$1=<hidden>')
    .replace(/\s+/g, ' ')
    .slice(0, 220);
}
function rawSnippet(value) {
  return String(value || '')
    .replace(/(authSid|sid|SID)\s*[:=]\s*["']?[^"',\s<]+/g, '$1=<hidden>')
    .replace(/<authSid>[\s\S]*?<\/authSid>/ig, '<authSid><hidden></authSid>')
    .replace(/<sid>[\s\S]*?<\/sid>/ig, '<sid><hidden></sid>')
    .replace(/\s+/g, ' ')
    .slice(0, 220);
}
function xmlTagSummary(raw) {
  const seen = new Set();
  const out = [];
  const re = /<([A-Za-z_][\w.-]*)\b[^>/]*>/g;
  let m;
  while ((m = re.exec(raw || '')) && out.length < 18) {
    const tag = m[1];
    if (seen.has(tag) || /^(QDocRoot|shutdown_info)$/i.test(tag)) continue;
    seen.add(tag);
    const value = textBetween(raw, tag);
    out.push(tag + (value ? '=' + value.slice(0, 28) : ''));
  }
  return out.join(', ');
}
function describeResponse(value) {
  if (!value) return 'empty response';
  if (value.raw != null) {
    const meta = value._meta ? ' http=' + value._meta.statusCode + ' bytes=' + value._meta.bytes + ' type=' + (value._meta.contentType || 'n/a') : '';
    const tags = xmlTagSummary(value.raw);
    return 'raw' + meta + ': ' + bodySnippet(value.raw) + (bodySnippet(value.raw) ? '' : ' [unstripped: ' + rawSnippet(value.raw) + ']') + (tags ? ' tags: ' + tags : '');
  }
  if (Array.isArray(value)) {
    const first = value.find(x => x && typeof x === 'object');
    return 'array length ' + value.length + (first ? ' first keys: ' + Object.keys(first).slice(0, 16).join(', ') : '');
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).slice(0, 12).join(', ');
    const flags = ['status', 'success', 'error', 'errno', 'message']
      .filter(k => Object.prototype.hasOwnProperty.call(value, k))
      .map(k => k + '=' + JSON.stringify(value[k]))
      .join(', ');
    return 'keys: ' + keys + (flags ? ' (' + flags + ')' : '');
  }
  return typeof value;
}
function hasRows(value) {
  if (!value || value.raw) return false;
  if (Array.isArray(value)) return true;
  return !!(Array.isArray(value.datas) || Array.isArray(value.children) || Array.isArray(value.volumes)
    || Array.isArray(value.shares) || Array.isArray(value.share_list) || Array.isArray(value.result)
    || (value.data && (Array.isArray(value.data.datas) || Array.isArray(value.data.children))));
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
  if (value == null) return null;
  return value * unitMultiplier(pick(row, unitKeys || []) || row.volume_unit || row.unit);
}
function firstObjectWithKeys(value, keys) {
  if (!value || typeof value !== 'object') return null;
  if (keys.some(key => Object.prototype.hasOwnProperty.call(value, key))) return value;
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = firstObjectWithKeys(child, keys);
      if (found) return found;
    }
  }
  return null;
}

class QnapClient {
  constructor(config) {
    this.config = config;
    this.sid = null;
    this.sidAt = 0;
    this.sidTtlMs = 20 * 60 * 1000;
    this.debug = { apiErrors: [], notes: [] };
    this.loginBody = null;
    this.cookies = {};
    this.lastResourceCounters = null;
  }

  configured() {
    const q = this.config.qnap;
    return !!(q.host && q.username && q.password);
  }

  async request(pathname, params, options) {
    options = options || {};
    if (!this.config.qnap.host) throw new Error('QNAP_HOST is not configured');
    const base = new URL(this.config.qnap.host);
    const url = new URL(pathname, base);
    for (const [key, value] of Object.entries(params || {})) {
      if (value != null) url.searchParams.set(key, value);
    }
    return new Promise((resolve, reject) => {
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(url, {
        method: 'GET',
        rejectUnauthorized: this.config.qnap.verifySsl,
        timeout: options.timeout || 8000,
        headers: Object.assign({
          Accept: 'application/json, text/xml, */*',
          Cookie: this.cookieHeader(),
        }, options.headers || {}),
      }, res => {
        this.storeCookies(res.headers['set-cookie']);
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const meta = {
            statusCode: res.statusCode,
            bytes: Buffer.byteLength(body),
            contentType: String(res.headers['content-type'] || ''),
          };
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error('QNAP returned HTTP ' + res.statusCode);
            err.statusCode = res.statusCode;
            err.body = bodySnippet(body);
            reject(err);
            return;
          }
          const ctype = String(res.headers['content-type'] || '');
          if (ctype.includes('json') || /^[\s\r\n]*[{[]/.test(body)) {
            try {
              const parsed = JSON.parse(body);
              if (parsed && typeof parsed === 'object') parsed._meta = meta;
              resolve(parsed);
            }
            catch (e) { resolve({ raw: body, _meta: meta }); }
          } else {
            resolve({ raw: body, _meta: meta });
          }
        });
      });
      req.on('timeout', () => req.destroy(new Error('QNAP request timed out')));
      req.on('error', reject);
      req.end();
    });
  }

  cookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => k + '=' + v).join('; ');
  }

  storeCookies(setCookie) {
    const rows = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
    for (const row of rows) {
      const first = String(row).split(';')[0];
      const idx = first.indexOf('=');
      if (idx > 0) this.cookies[first.slice(0, idx).trim()] = first.slice(idx + 1).trim();
    }
  }

  async login(force) {
    if (!force && this.sid && Date.now() - this.sidAt < this.sidTtlMs) return this.sid;
    if (!this.configured()) throw new Error('QNAP credentials are not configured');
    const q = this.config.qnap;
    const encoded = Buffer.from(q.password, 'utf8').toString('base64');
    const attempts = [
      { user: q.username, pwd: encoded, serviceKey: 1 },
      { user: q.username, pwd: encoded },
      { user: q.username, plain_pwd: q.password, serviceKey: 1 },
      { user: q.username, plain_pwd: q.password },
    ];
    let lastError = null;
    for (const params of attempts) {
      try {
        const body = await this.request('/cgi-bin/authLogin.cgi', params);
        const sid = this.extractSid(body);
        if (sid) {
          this.sid = sid;
          this.sidAt = Date.now();
          this.loginBody = body;
          this.debug.notes.push('login response: ' + describeResponse(body));
          this.debug.notes.push('auth sid: length ' + String(sid).length);
          return sid;
        }
        lastError = new Error('QNAP login did not return a session id');
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error('QNAP login failed');
  }

  extractSid(body) {
    if (!body) return null;
    if (typeof body === 'object' && !body.raw) {
      return body.authSid || body.sid || body.SID || (body.result && (body.result.authSid || body.result.sid)) || null;
    }
    const raw = body.raw || String(body);
    return textBetween(raw, 'authSid') || textBetween(raw, 'sid') || textBetween(raw, 'SID');
  }

  async api(pathname, params, retry) {
    const sid = await this.login(false);
    try {
      return await this.request(pathname, Object.assign({}, params || {}, { sid }));
    } catch (e) {
      if (retry === false) throw e;
      this.sid = null;
      const freshSid = await this.login(true);
      return this.request(pathname, Object.assign({}, params || {}, { sid: freshSid }));
    }
  }

  async apiWithSidParam(pathname, params, sidParam) {
    const sid = await this.login(false);
    if (sidParam === 'cookie') return this.request(pathname, params || {});
    return this.request(pathname, Object.assign({}, params || {}, { [sidParam || 'sid']: sid }));
  }

  async optional(label, fn) {
    try {
      const value = await fn();
      this.debug.notes.push(label + ': response received (' + describeResponse(value) + ')');
      return { ok: true, value };
    } catch (e) {
      this.debug.apiErrors.push({
        label,
        message: e.message,
        statusCode: e.statusCode || null,
        body: e.body || null,
      });
      return { ok: false, label, error: e.message };
    }
  }

  async getSystemStatus() {
    if (!this.loginBody) {
      try { await this.login(true); } catch (e) {}
    }
    const fromLogin = this.normalizeSystem(this.loginBody || {});
    if (fromLogin.name || fromLogin.model || fromLogin.firmware) {
      this.debug.notes.push('system status: using login response metadata');
      return fromLogin;
    }
    const candidates = [
      ['/cgi-bin/sys/sysRequest.cgi', { subfunc: 'sysinfo', apply: 1 }],
      ['/cgi-bin/sys/sysRequest.cgi', { func: 'get_system_info' }],
      ['/cgi-bin/sys/sysRequest.cgi', { func: 'get_sys_info' }],
      ['/cgi-bin/sys/sysRequest.cgi', { func: 'get_system_status' }],
      ['/cgi-bin/sys/sysRequest.cgi', { subfunc: 'system_info' }],
      ['/cgi-bin/sys/sysRequest.cgi', { subfunc: 'system_status' }],
      ['/cgi-bin/sys/sysRequest.cgi', { subfunc: 'hw_info' }],
      ['/cgi-bin/management/manaRequest.cgi', { subfunc: 'sysinfo' }],
      ['/cgi-bin/management/manaRequest.cgi', { subfunc: 'sys_info' }],
      ['/cgi-bin/management/manaRequest.cgi', { subfunc: 'sysinfo', apply: 1 }],
      ['/cgi-bin/management/manaRequest.cgi', { subfunc: 'system', func: 'get_summary' }],
      ['/cgi-bin/sys/sysRequest.cgi', { subfunc: 'get_system_status' }],
    ];
    for (const [path, params] of candidates) {
      const r = await this.optional('system status', () => this.api(path, params));
      if (r.ok) {
        const system = this.normalizeSystem(r.value);
        if (system.name || system.model || system.firmware || system.uptime || system.cpuPercent != null || system.ramPercent != null) return system;
        this.debug.notes.push('system status: response had no recognized system fields');
      }
    }
    this.debug.notes.push('system status: no supported endpoint returned usable data');
    return {};
  }

  async getResources() {
    const fallback = {
      cpuPercent: null,
      ramPercent: null,
      network: { downloadBytesPerSecond: null, uploadBytesPerSecond: null },
    };
    const candidates = [
      ['/cgi-bin/management/manaRequest.cgi', { subfunc: 'sysinfo', hd: 'no', multicpu: 1 }],
      ['/cgi-bin/management/manaRequest.cgi', { subfunc: 'sysinfo', hd: 'yes', multicpu: 1 }],
      ['/cgi-bin/management/manaRequest.cgi', { subfunc: 'resource_monitor', hd: 'no', multicpu: 1 }],
    ];
    for (const [path, params] of candidates) {
      const r = await this.optional('resources', () => this.api(path, params));
      if (!r.ok) continue;
      this.debugResourceShape(r.value);
      const resources = this.withNetworkCounterRates(this.normalizeResources(r.value));
      if (resources.cpuPercent != null || resources.ramPercent != null
        || resources.network.downloadBytesPerSecond != null || resources.network.uploadBytesPerSecond != null) {
        return resources;
      }
      this.debug.notes.push('resources: response had no recognized resource fields');
    }
    return fallback;
  }

  debugResourceShape(value) {
    if (!value || !value.raw) return;
    const root = nestedBlock(value.raw, ['func', 'ownContent', 'root']) || value.raw;
    const tags = xmlTagSummary(root);
    if (tags) this.debug.notes.push('resources root tags: ' + tags);
  }

  normalizeResources(body) {
    const raw = body && body.raw ? body.raw : '';
    const data = body && !body.raw ? body : {};
    const resourceKeys = [
      'cpu_usage', 'cpuUsage', 'cpu_percent',
      'mem_usage', 'memory_usage', 'ram_usage', 'memUsage',
      'rx_rate', 'tx_rate', 'rxBytesSec', 'txBytesSec',
      'rx_bytes', 'tx_bytes', 'rx_total', 'tx_total',
    ];
    const nested = firstObjectWithKeys(data, resourceKeys) || {};
    const root = raw ? (nestedBlock(raw, ['func', 'ownContent', 'root']) || raw) : '';
    const cpu = this.normalizePercent(
      pick(nested, ['cpu_usage', 'cpu_usage_percent', 'cpuUsage', 'cpu_percent'])
      || pick(data, ['cpu_usage', 'cpu_usage_percent', 'cpuUsage', 'cpu_percent'])
      || firstXmlValue(root, ['cpu_usage', 'cpu_usage_percent', 'cpuUsage', 'cpu_percent'])
    );
    const ram = this.normalizePercent(
      pick(nested, ['mem_usage', 'memory_usage', 'ram_usage', 'memUsage', 'ram_percent', 'memory_percent', 'memory_usage_percent', 'mem_percent', 'mem'])
      || pick(data, ['mem_usage', 'memory_usage', 'ram_usage', 'memUsage', 'ram_percent', 'memory_percent', 'memory_usage_percent', 'mem_percent', 'mem'])
      || firstXmlValue(root, ['mem_usage', 'memory_usage', 'ram_usage', 'memUsage', 'ram_percent', 'memory_percent', 'memory_usage_percent', 'mem_percent', 'mem'])
    );
    const totalMem = this.resourceBytes(root, nested, data, ['total_mem', 'total_memory', 'mem_total', 'memory_total']);
    const freeMem = this.resourceBytes(root, nested, data, ['free_mem', 'free_memory', 'mem_free', 'memory_free', 'available_memory']);
    const usedMem = this.resourceBytes(root, nested, data, ['used_mem', 'used_memory', 'mem_used', 'memory_used']);
    const derivedRam = ram != null ? ram : this.deriveMemoryPercent(totalMem, freeMem, usedMem);
    const down = this.networkRate(
      pick(nested, ['downloadBytesPerSecond', 'rxBytesSec', 'rx_rate', 'rxRate', 'download_rate', 'down', 'rx_bytes_sec', 'recv_rate', 'receive_rate'])
      || pick(data, ['downloadBytesPerSecond', 'rxBytesSec', 'rx_rate', 'rxRate', 'download_rate', 'down', 'rx_bytes_sec', 'recv_rate', 'receive_rate'])
      || firstXmlValue(root, ['downloadBytesPerSecond', 'rxBytesSec', 'rx_rate', 'rxRate', 'download_rate', 'down', 'rx_bytes_sec', 'recv_rate', 'receive_rate'])
    );
    const up = this.networkRate(
      pick(nested, ['uploadBytesPerSecond', 'txBytesSec', 'tx_rate', 'txRate', 'upload_rate', 'up', 'tx_bytes_sec', 'send_rate', 'sent_rate'])
      || pick(data, ['uploadBytesPerSecond', 'txBytesSec', 'tx_rate', 'txRate', 'upload_rate', 'up', 'tx_bytes_sec', 'send_rate', 'sent_rate'])
      || firstXmlValue(root, ['uploadBytesPerSecond', 'txBytesSec', 'tx_rate', 'txRate', 'upload_rate', 'up', 'tx_bytes_sec', 'send_rate', 'sent_rate'])
    );
    const adapterRates = (down == null || up == null) ? this.adapterRatesFromResourceText(root) : null;
    const rxTotal = this.networkRate(
      pick(nested, ['rx', 'rx_bytes', 'rx_total', 'recv', 'receive', 'total_rx', 'in_bytes'])
      || pick(data, ['rx', 'rx_bytes', 'rx_total', 'recv', 'receive', 'total_rx', 'in_bytes'])
      || firstXmlValue(root, ['rx', 'rx_bytes', 'rx_total', 'recv', 'receive', 'total_rx', 'in_bytes'])
    );
    const txTotal = this.networkRate(
      pick(nested, ['tx', 'tx_bytes', 'tx_total', 'send', 'sent', 'total_tx', 'out_bytes'])
      || pick(data, ['tx', 'tx_bytes', 'tx_total', 'send', 'sent', 'total_tx', 'out_bytes'])
      || firstXmlValue(root, ['tx', 'tx_bytes', 'tx_total', 'send', 'sent', 'total_tx', 'out_bytes'])
    );
    return {
      cpuPercent: cpu,
      ramPercent: derivedRam,
      network: {
        downloadBytesPerSecond: down != null ? down : (adapterRates && adapterRates.downloadBytesPerSecond),
        uploadBytesPerSecond: up != null ? up : (adapterRates && adapterRates.uploadBytesPerSecond),
        rxTotalBytes: rxTotal,
        txTotalBytes: txTotal,
      },
    };
  }

  adapterRatesFromResourceText(raw) {
    const text = stripTags(raw).replace(/\s+/g, ' ').trim();
    const matches = [...text.matchAll(/\b(?:eth\d+|bond\d+|trunk\d+)\s+Adapter\s+\d+\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/gi)];
    if (!matches.length) return null;
    let download = 0;
    let upload = 0;
    for (const m of matches) {
      download += Number(m[1]) || 0;
      upload += Number(m[2]) || 0;
    }
    this.debug.notes.push('resources: parsed network adapter text rates');
    return {
      downloadBytesPerSecond: Math.round(download),
      uploadBytesPerSecond: Math.round(upload),
    };
  }

  withNetworkCounterRates(resources) {
    const now = Date.now();
    const rx = resources.network.rxTotalBytes;
    const tx = resources.network.txTotalBytes;
    if (resources.network.downloadBytesPerSecond != null && resources.network.uploadBytesPerSecond != null) {
      this.lastResourceCounters = rx != null || tx != null ? { at: now, rx, tx } : this.lastResourceCounters;
      return resources;
    }
    if (rx == null && tx == null) return resources;
    const prev = this.lastResourceCounters;
    this.lastResourceCounters = { at: now, rx, tx };
    if (!prev) {
      this.debug.notes.push('resources: network counters found; rate available after next refresh');
      return resources;
    }
    const seconds = Math.max(1, (now - prev.at) / 1000);
    if (resources.network.downloadBytesPerSecond == null && rx != null && prev.rx != null && rx >= prev.rx) {
      resources.network.downloadBytesPerSecond = Math.round((rx - prev.rx) / seconds);
    }
    if (resources.network.uploadBytesPerSecond == null && tx != null && prev.tx != null && tx >= prev.tx) {
      resources.network.uploadBytesPerSecond = Math.round((tx - prev.tx) / seconds);
    }
    return resources;
  }

  resourceBytes(root, nested, data, keys) {
    return this.networkRate(pick(nested, keys) || pick(data, keys) || firstXmlValue(root, keys));
  }

  deriveMemoryPercent(total, free, used) {
    if (total == null || total <= 0) return null;
    const actualUsed = used != null ? used : (free != null ? total - free : null);
    return percent(actualUsed, total);
  }

  normalizeSystem(body) {
    const raw = body && body.raw ? body.raw : '';
    const data = body && !body.raw ? body : {};
    const nested = data && (data.result || data.data || data.system || data.sysinfo) || {};
    const firmwareBlock = raw ? firstBlock(raw, 'firmware') : '';
    const firmwareName = firstXmlValue(firmwareBlock, ['name']);
    const firmwareVersion = firstXmlValue(firmwareBlock, ['version']);
    const firmwareNumber = firstXmlValue(firmwareBlock, ['number']);
    const firmwareText = [firmwareName, firmwareVersion, firmwareNumber && 'build ' + firmwareNumber].filter(Boolean).join(' ');
    return {
      name: asText(pick(data, ['server_name', 'serverName', 'hostname', 'hostName', 'name']) || pick(nested, ['server_name', 'serverName', 'hostname', 'hostName', 'name']) || textBetween(raw, 'serverName') || textBetween(raw, 'hostname')),
      model: asText(pick(data, ['displayModelName', 'display_model', 'model', 'modelName']) || pick(nested, ['displayModelName', 'display_model', 'model', 'modelName']) || textBetween(raw, 'displayModelName') || textBetween(raw, 'modelName') || textBetween(raw, 'model')),
      firmware: asText(pick(data, ['firmware', 'version', 'fw_version', 'firmwareVersion']) || pick(nested, ['firmware', 'version', 'fw_version', 'firmwareVersion']) || firmwareText || textBetween(raw, 'firmwareVersion')),
      uptime: asText(pick(data, ['uptime', 'up_time']) || pick(nested, ['uptime', 'up_time']) || textBetween(raw, 'uptime')),
      cpuPercent: this.normalizePercent(pick(data, ['cpu_usage', 'cpu_usage_percent', 'cpuUsage', 'cpu_percent']) || pick(nested, ['cpu_usage', 'cpu_usage_percent', 'cpuUsage', 'cpu_percent']) || firstXmlValue(raw, ['cpu_usage', 'cpu_usage_percent', 'cpuUsage', 'cpu_percent'])),
      ramPercent: this.normalizePercent(pick(data, ['mem_usage', 'memory_usage', 'ram_usage', 'memUsage', 'ram_percent', 'memory_percent']) || pick(nested, ['mem_usage', 'memory_usage', 'ram_usage', 'memUsage', 'ram_percent', 'memory_percent']) || firstXmlValue(raw, ['mem_usage', 'memory_usage', 'ram_usage', 'memUsage', 'ram_percent', 'memory_percent'])),
      statusText: 'Online',
    };
  }

  normalizePercent(value) {
    if (typeof value === 'string') value = value.replace('%', '').trim();
    const n = toNumber(value);
    if (n == null) return null;
    if (n >= 0 && n <= 1) return Math.round(n * 100);
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  networkRate(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'string') {
      const m = /^\s*([\d.]+)\s*([KMGT]?B)(?:\/s)?\s*$/i.exec(value);
      if (m) return Math.round(Number(m[1]) * unitMultiplier(m[2]));
    }
    return toNumber(value);
  }

  async getNetworkStatus() {
    const candidates = [
      ['/cgi-bin/management/manaRequest.cgi', { subfunc: 'resource_monitor' }],
      ['/cgi-bin/management/manaRequest.cgi', { subfunc: 'network' }],
      ['/cgi-bin/sys/sysRequest.cgi', { subfunc: 'network' }],
      ['/cgi-bin/sys/sysRequest.cgi', { func: 'get_network_info' }],
    ];
    for (const [path, params] of candidates) {
      const r = await this.optional('network', () => this.api(path, params));
      if (!r.ok) continue;
      const net = this.normalizeNetwork(r.value);
      if (net.uploadBps != null || net.downloadBps != null || net.interfaces.length) return net;
      this.debug.notes.push('network: response had no recognized network fields');
    }
    return { uploadBps: null, downloadBps: null, interfaces: [] };
  }

  normalizeNetwork(body) {
    const raw = body && body.raw ? body.raw : '';
    const data = body && !body.raw ? body : {};
    const upload = toNumber(pick(data, ['uploadBps', 'txBytesSec', 'tx_rate', 'txRate', 'up']) || firstXmlValue(raw, ['uploadBps', 'txBytesSec', 'tx_rate', 'txRate', 'up']));
    const download = toNumber(pick(data, ['downloadBps', 'rxBytesSec', 'rx_rate', 'rxRate', 'down']) || firstXmlValue(raw, ['downloadBps', 'rxBytesSec', 'rx_rate', 'rxRate', 'down']));
    const rows = Array.isArray(data.interfaces) ? data.interfaces
      : Array.isArray(data.datas) ? data.datas
      : Array.isArray(data) ? data
      : [];
    return {
      uploadBps: upload,
      downloadBps: download,
      interfaces: rows.map(row => ({
        name: asText(row.name || row.iface || row.interface || row.id),
        status: asText(row.status || row.link || row.state),
      })).filter(row => row.name),
    };
  }

  async getStorage() {
    const candidates = [
      ['/cgi-bin/disk/disk_manage.cgi', { func: 'extra_get', type: 'volume' }],
      ['/cgi-bin/disk/disk_manage.cgi', { func: 'get_volume_info' }],
      ['/cgi-bin/disk/disk_manage.cgi', { func: 'get_storage_pool' }],
      ['/cgi-bin/disk/disk_manage.cgi', { func: 'get_disk_list' }],
      ['/cgi-bin/management/manaRequest.cgi', { subfunc: 'disk', func: 'volume' }],
      ['/cgi-bin/management/manaRequest.cgi', { subfunc: 'storage', func: 'volume' }],
      ['/cgi-bin/filemanager/utilRequest.cgi', { func: 'get_tree', node: 'vol_root', is_iso: 0, check_acl: 0, hidden_file: 0, recycle: 0 }],
    ];
    for (const [path, params] of candidates) {
      const r = await this.optional('storage', () => this.api(path, params));
      if (r.ok) {
        const storage = this.normalizeStorage(r.value);
        if (storage.percentUsed != null || storage.usedBytes != null || storage.totalBytes != null || storage.pools.some(p => p.percentUsed != null)) return storage;
        this.debug.notes.push('storage: response had no recognized storage fields');
      }
    }
    this.debug.notes.push('storage: no supported endpoint returned usable data');
    return { usedBytes: null, totalBytes: null, percentUsed: null, pools: [] };
  }

  normalizeStorage(body) {
    const data = body && !body.raw ? body : {};
    const raw = body && body.raw ? body.raw : '';
    if (raw) {
      const fromXml = this.normalizeStorageXml(raw);
      if (fromXml.usedBytes != null || fromXml.totalBytes != null || fromXml.pools.length) return fromXml;
    }
    const rows = Array.isArray(data.datas) ? data.datas
      : Array.isArray(data.volumes) ? data.volumes
      : Array.isArray(data.children) ? data.children
      : Array.isArray(data) ? data
      : [];
    let used = sizedValue(data, ['used_size', 'used', 'total_used', 'usedSize']);
    let total = sizedValue(data, ['total_size', 'total', 'capacity', 'size']);
    const pools = rows.slice(0, 6).map((row, i) => {
      const size = sizedValue(row, ['total_size', 'total', 'capacity', 'size', 'total_bytes', 'totalByte']);
      const usedKeys = ['used_size', 'used', 'usedSize', 'used_bytes', 'usedByte'];
      let rowUsed = hasAny(row, usedKeys) ? sizedValue(row, usedKeys) : null;
      const free = sizedValue(row, ['free_size', 'free', 'available', 'available_size', 'free_bytes', 'freeByte']);
      if (rowUsed == null && size != null && free != null) rowUsed = size - free;
      if (used == null && rowUsed != null) used = 0;
      if (total == null && size != null) total = 0;
      if (rowUsed != null) used += rowUsed;
      if (size != null) total += size;
      return {
        name: asText(row.name || row.label || row.vol_label || row.filename || row.text || row.volume_label || row.volume_name || row.mount_path) || 'Pool ' + (i + 1),
        status: asText(row.status || row.health || row.vol_status || row.volume_status || row.volume_avail) || 'N/A',
        percentUsed: percent(rowUsed, size),
      };
    });
    if (used == null) used = toNumber(textBetween(raw, 'used_size'));
    if (total == null) total = toNumber(textBetween(raw, 'total_size'));
    if (!total) {
      used = null;
      total = null;
    }
    return { usedBytes: used, totalBytes: total, percentUsed: percent(used, total), pools };
  }

  normalizeStorageXml(raw) {
    const poolTags = ['volume', 'Volume', 'volume_info', 'row', 'item'];
    let blocks = [];
    for (const tag of poolTags) {
      blocks = allBlocks(raw, tag);
      if (blocks.length) break;
    }
    if (!blocks.length) blocks = [raw];
    let used = null;
    let total = null;
    const pools = blocks.map((block, i) => {
      const size = this.xmlSize(block, ['total_size', 'totalSize', 'total', 'capacity', 'size']);
      let rowUsed = this.xmlSize(block, ['used_size', 'usedSize', 'used', 'total_used']);
      const free = this.xmlSize(block, ['free_size', 'freeSize', 'free', 'available', 'available_size']);
      if (rowUsed == null && size != null && free != null) rowUsed = size - free;
      if (rowUsed != null) used = (used || 0) + rowUsed;
      if (size != null) total = (total || 0) + size;
      return {
        name: firstXmlValue(block, ['volume_label', 'vol_label', 'label', 'name', 'volume_name', 'mount_path']) || 'Pool ' + (i + 1),
        status: firstXmlValue(block, ['status', 'health', 'vol_status']) || 'N/A',
        percentUsed: percent(rowUsed, size),
      };
    }).filter(row => row.percentUsed != null);
    if (used == null) used = this.xmlSize(raw, ['used_size', 'usedSize', 'used', 'total_used']);
    if (total == null) total = this.xmlSize(raw, ['total_size', 'totalSize', 'total', 'capacity', 'size']);
    if (!total) {
      used = null;
      total = null;
    }
    return { usedBytes: used, totalBytes: total, percentUsed: percent(used, total), pools };
  }

  xmlSize(raw, tags) {
    if (!tags.some(tag => new RegExp('<' + tag + '\\b', 'i').test(raw))) return null;
    const value = toNumber(firstXmlValue(raw, tags));
    if (value == null) return null;
    return value * unitMultiplier(firstXmlValue(raw, ['volume_unit', 'unit', 'size_unit']) || '');
  }

  async getShares() {
    const candidates = [
      ['/cgi-bin/filemanager/utilRequest.cgi', { func: 'get_tree', node: 'share_root', is_iso: 0, check_acl: 0, hidden_file: 0, recycle: 0 }],
      ['/cgi-bin/filemanager/utilRequest.cgi', { func: 'get_tree', node: 'share_root', is_iso: 0 }],
      ['/cgi-bin/filemanager/utilRequest.cgi', { func: 'get_tree', node: 'share_root' }],
      ['/cgi-bin/filemanager/utilRequest.cgi', { func: 'get_tree', node: 'vol_root', is_iso: 0, check_acl: 0, hidden_file: 0, recycle: 0 }],
    ];
    for (const [path, params] of candidates) {
      const r = await this.optional('shares ' + (params.node == null ? params.func : 'node=' + JSON.stringify(params.node)), () => this.api(path, params));
      if (!r.ok) continue;
      if (!hasRows(r.value)) {
        this.debug.notes.push('shares: wrapper without rows (' + describeResponse(r.value) + ')');
        continue;
      }
      const rows = this.shareRows(r.value);
      if (rows.length) {
        return rows.slice(0, 8).map(row => ({
          name: asText(row.filename || row.name || row.text || row.label || row.share_name) || 'Share',
          status: row.isfolder === 0 ? 'File' : asText(row.status) || 'Ready',
        }));
      }
    }
    this.debug.notes.push('shares: no share rows found in supported File Station responses');
    return [];
  }

  async probeQtsEndpoints() {
    const probes = [
      ['probe sysinfo mana', '/cgi-bin/management/manaRequest.cgi', { subfunc: 'sysinfo' }, 'sid'],
      ['probe sysinfo mana authSid', '/cgi-bin/management/manaRequest.cgi', { subfunc: 'sysinfo' }, 'authSid'],
      ['probe sysinfo mana cookie', '/cgi-bin/management/manaRequest.cgi', { subfunc: 'sysinfo' }, 'cookie'],
      ['probe sys_info mana', '/cgi-bin/management/manaRequest.cgi', { subfunc: 'sys_info' }, 'sid'],
      ['probe sysinfo sys', '/cgi-bin/sys/sysRequest.cgi', { subfunc: 'sysinfo' }, 'sid'],
      ['probe sysinfo sys cookie', '/cgi-bin/sys/sysRequest.cgi', { subfunc: 'sysinfo' }, 'cookie'],
      ['probe get_system_info sys', '/cgi-bin/sys/sysRequest.cgi', { func: 'get_system_info' }, 'sid'],
      ['probe get_sys_info sys', '/cgi-bin/sys/sysRequest.cgi', { func: 'get_sys_info' }, 'sid'],
      ['probe get_system_status sys', '/cgi-bin/sys/sysRequest.cgi', { func: 'get_system_status' }, 'sid'],
      ['probe system_info sys', '/cgi-bin/sys/sysRequest.cgi', { subfunc: 'system_info' }, 'sid'],
      ['probe system_status sys', '/cgi-bin/sys/sysRequest.cgi', { subfunc: 'system_status' }, 'sid'],
      ['probe hw_info sys', '/cgi-bin/sys/sysRequest.cgi', { subfunc: 'hw_info' }, 'sid'],
      ['probe system health', '/cgi-bin/management/manaRequest.cgi', { subfunc: 'system_health' }, 'sid'],
      ['probe resource monitor', '/cgi-bin/management/manaRequest.cgi', { subfunc: 'resource_monitor' }, 'sid'],
      ['probe volume tree', '/cgi-bin/filemanager/utilRequest.cgi', { func: 'get_tree', node: 'vol_root', is_iso: 0, check_acl: 0, hidden_file: 0, recycle: 0 }, 'sid'],
      ['probe volume tree authSid', '/cgi-bin/filemanager/utilRequest.cgi', { func: 'get_tree', node: 'vol_root', is_iso: 0, check_acl: 0, hidden_file: 0, recycle: 0 }, 'authSid'],
      ['probe volume tree cookie', '/cgi-bin/filemanager/utilRequest.cgi', { func: 'get_tree', node: 'vol_root', is_iso: 0, check_acl: 0, hidden_file: 0, recycle: 0 }, 'cookie'],
      ['probe volume extra', '/cgi-bin/disk/disk_manage.cgi', { func: 'extra_get', type: 'volume' }, 'sid'],
      ['probe volume extra cookie', '/cgi-bin/disk/disk_manage.cgi', { func: 'extra_get', type: 'volume' }, 'cookie'],
      ['probe volume info', '/cgi-bin/disk/disk_manage.cgi', { func: 'get_volume_info' }, 'sid'],
      ['probe storage pool', '/cgi-bin/disk/disk_manage.cgi', { func: 'get_storage_pool' }, 'sid'],
      ['probe disk list', '/cgi-bin/disk/disk_manage.cgi', { func: 'get_disk_list' }, 'sid'],
      ['probe storage info', '/cgi-bin/management/manaRequest.cgi', { subfunc: 'disk', func: 'volume' }, 'sid'],
      ['probe share tree', '/cgi-bin/filemanager/utilRequest.cgi', { func: 'get_tree', node: 'share_root', is_iso: 0, check_acl: 0, hidden_file: 0, recycle: 0 }, 'sid'],
      ['probe share tree authSid', '/cgi-bin/filemanager/utilRequest.cgi', { func: 'get_tree', node: 'share_root', is_iso: 0, check_acl: 0, hidden_file: 0, recycle: 0 }, 'authSid'],
      ['probe share tree cookie', '/cgi-bin/filemanager/utilRequest.cgi', { func: 'get_tree', node: 'share_root', is_iso: 0, check_acl: 0, hidden_file: 0, recycle: 0 }, 'cookie'],
      ['probe share list', '/cgi-bin/filemanager/share.cgi', { func: 'get_share_list' }, 'sid'],
    ];
    const results = [];
    for (const [label, path, params, sidParam] of probes) {
      const fullLabel = label + ' ' + path + '?' + Object.entries(params).map(([k, v]) => k + '=' + v).join('&') + (sidParam === 'cookie' ? ' + cookies' : '&' + sidParam + '=<hidden>');
      const r = await this.optional(label, () => this.apiWithSidParam(path, params, sidParam));
      if (r.ok) results.push(fullLabel + ': ' + describeResponse(r.value));
      else results.push(label + ': ' + r.error);
    }
    this.debug.probes = results;
  }

  shareRows(value) {
    if (Array.isArray(value)) return value;
    const data = value && !value.raw ? value : {};
    if (Array.isArray(data.datas)) return data.datas;
    if (Array.isArray(data.children)) return data.children;
    if (Array.isArray(data.shares)) return data.shares;
    if (Array.isArray(data.share_list)) return data.share_list;
    if (data.data && Array.isArray(data.data.datas)) return data.data.datas;
    if (data.result && Array.isArray(data.result)) return data.result;
    return [];
  }

  async getRecentFiles(shares) {
    shares = Array.isArray(shares) ? shares : await this.getShares();
    const first = shares[0] && shares[0].name;
    if (!first) return [];
    const r = await this.optional('recent files', () => this.api('/cgi-bin/filemanager/utilRequest.cgi', {
      func: 'get_list',
      list_mode: 'all',
      path: '/' + first,
      limit: 5,
      sort: 'mtime',
      dir: 'DESC',
    }));
    if (!r.ok) return [];
    const data = r.value && !r.value.raw ? r.value : {};
    const rows = Array.isArray(data.datas) ? data.datas : Array.isArray(data.files) ? data.files : [];
    return rows.slice(0, 5).map(row => ({
      name: asText(row.filename || row.name) || 'File',
      path: asText(row.path || ('/' + first)),
      modified: asText(row.mtime || row.modified || row.time),
    }));
  }

  async getSummary() {
    const started = Date.now();
    this.debug = { apiErrors: [], notes: [] };
    if (!this.configured()) {
      return this.emptySummary(false, 'Set the QNAP URL, username, and password in the QNAP NAS app settings.');
    }
    try {
      await this.login(false);
      this.debug.notes.push('login: session established');
      const cookieNames = Object.keys(this.cookies);
      if (cookieNames.length) this.debug.notes.push('cookies: ' + cookieNames.join(', '));
      const [system, storage, shares] = await Promise.all([
        this.getSystemStatus(),
        this.getStorage(),
        this.getShares(),
      ]);
      const resources = await this.getResources();
      const networkStatus = await this.getNetworkStatus();
      const network = {
        downloadBps: resources.network.downloadBytesPerSecond != null ? resources.network.downloadBytesPerSecond : networkStatus.downloadBps,
        uploadBps: resources.network.uploadBytesPerSecond != null ? resources.network.uploadBytesPerSecond : networkStatus.uploadBps,
        interfaces: networkStatus.interfaces || [],
      };
      const recent = await this.getRecentFiles(shares);
      if (!system.name && !system.model && storage.percentUsed == null && !storage.pools.length && !shares.length && !recent.length) {
        await this.probeQtsEndpoints();
        this.debug.notes.push('connected, but no supported QNAP data endpoint returned dashboard data');
      }
      return {
        ok: true,
        online: true,
        error: null,
        generatedAt: nowIso(),
        latencyMs: Date.now() - started,
        refreshSeconds: this.config.dashboard.refreshSeconds,
        system: Object.assign({ statusText: 'Online' }, system, {
          cpuPercent: resources.cpuPercent != null ? resources.cpuPercent : system.cpuPercent,
          ramPercent: resources.ramPercent != null ? resources.ramPercent : system.ramPercent,
        }),
        storage,
        shares,
        recentFiles: recent,
        diskHealth: { status: storage.pools && storage.pools.length ? 'Available' : 'N/A', healthy: null, warning: null },
        network,
        services: this.serviceSummary(storage, shares),
        alerts: [],
        debug: this.debug,
      };
    } catch (e) {
      this.sid = null;
      return this.emptySummary(false, e.message);
    }
  }

  serviceSummary(storage, shares) {
    const services = [{ name: 'QTS', status: 'Online' }];
    if (Array.isArray(shares) && shares.length) services.push({ name: 'File Station', status: 'Ready' });
    if (storage && storage.percentUsed != null) services.push({ name: 'Storage', status: 'Ready' });
    return services;
  }

  emptySummary(online, error) {
    return {
      ok: false,
      online: !!online,
      error: error || 'Unavailable',
      generatedAt: nowIso(),
      refreshSeconds: this.config.dashboard.refreshSeconds,
      system: { name: null, model: null, firmware: null, uptime: null, cpuPercent: null, ramPercent: null, statusText: online ? 'Online' : 'Offline' },
      storage: { usedBytes: null, totalBytes: null, percentUsed: null, pools: [] },
      shares: [],
      recentFiles: [],
      diskHealth: { status: 'N/A', healthy: null, warning: null },
      network: { uploadBps: null, downloadBps: null, interfaces: [] },
      services: [],
      alerts: [stripTags(error || 'QNAP unavailable')],
      debug: {
        apiErrors: error ? [{ label: 'summary', message: stripTags(error), statusCode: null, body: null }] : [],
        notes: [],
      },
    };
  }
}

module.exports = QnapClient;
