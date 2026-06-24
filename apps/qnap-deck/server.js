'use strict';

const QnapClient = require('./qnapClient');

let client = null;
let clientKey = '';
let lastGood = null;

function qnapConfigFromOptions(opts) {
  opts = opts || {};
  const refreshSeconds = Math.max(5, Math.min(300, parseInt(opts.refreshSeconds, 10) || 15));
  return {
    qnap: {
      host: String(opts.host || '').replace(/\/+$/, ''),
      username: String(opts.username || ''),
      password: String(opts.password || ''),
      verifySsl: !!opts.verifySsl,
    },
    dashboard: { refreshSeconds },
  };
}

function activeClient(options) {
  const cfg = qnapConfigFromOptions(options);
  const key = JSON.stringify(cfg.qnap);
  if (!client || key !== clientKey) {
    client = new QnapClient(cfg);
    clientKey = key;
    lastGood = null;
  } else {
    client.config.dashboard = cfg.dashboard;
  }
  return client;
}

async function summary(options) {
  const data = await activeClient(options).getSummary();
  if (data.ok) lastGood = data;
  else if (lastGood) data.lastGood = lastGood;
  return data;
}

async function handle(action, ctx) {
  const options = ctx && ctx.options || {};
  if (action === 'summary' || action === 'status' || action === 'system-health') return summary(options);
  if (action === 'resources') return activeClient(options).getResources();
  if (action === 'storage') return (await summary(options)).storage;
  if (action === 'shares') return (await summary(options)).shares;
  if (action === 'recent-files') return (await summary(options)).recentFiles;
  if (action === 'network') return (await summary(options)).network;
  if (action === 'services') return (await summary(options)).services;
  return { ok: false, error: 'unknown action' };
}

module.exports = { handle };
