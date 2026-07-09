'use strict';

const { canonicalProviderId } = require('./providers');

class TokenStorage {
  constructor({ getConfig, saveConfig }) {
    this.getConfig = getConfig;
    this.saveConfig = saveConfig;
  }

  oauthRoot() {
    const config = this.getConfig();
    if (!config.settings) config.settings = {};
    if (!config.settings.oauth || typeof config.settings.oauth !== 'object') {
      config.settings.oauth = { providers: {}, tokens: {} };
    }
    if (!config.settings.oauth.providers || typeof config.settings.oauth.providers !== 'object') config.settings.oauth.providers = {};
    if (!config.settings.oauth.tokens || typeof config.settings.oauth.tokens !== 'object') config.settings.oauth.tokens = {};
    if (config.settings.oauth.providers.teams && !config.settings.oauth.providers.microsoft) {
      config.settings.oauth.providers.microsoft = config.settings.oauth.providers.teams;
      delete config.settings.oauth.providers.teams;
      this.saveConfig();
    }
    if (config.settings.oauth.tokens.teams && !config.settings.oauth.tokens.microsoft) {
      config.settings.oauth.tokens.microsoft = Object.assign({}, config.settings.oauth.tokens.teams, { provider: 'microsoft' });
      delete config.settings.oauth.tokens.teams;
      this.saveConfig();
    }
    return config.settings.oauth;
  }

  getProviderSettings(provider) {
    provider = canonicalProviderId(provider);
    const root = this.oauthRoot();
    return Object.assign({}, root.providers[provider] || {});
  }

  setProviderSettings(provider, patch) {
    provider = canonicalProviderId(provider);
    const root = this.oauthRoot();
    root.providers[provider] = Object.assign({}, root.providers[provider] || {}, patch || {});
    this.saveConfig();
    return Object.assign({}, root.providers[provider]);
  }

  getTokens(provider) {
    provider = canonicalProviderId(provider);
    const root = this.oauthRoot();
    const t = root.tokens[provider];
    return t && typeof t === 'object' ? Object.assign({}, t) : null;
  }

  setTokens(provider, tokens) {
    provider = canonicalProviderId(provider);
    const root = this.oauthRoot();
    root.tokens[provider] = Object.assign({}, tokens || {}, { provider, updatedAt: Date.now() });
    this.saveConfig();
    return Object.assign({}, root.tokens[provider]);
  }

  deleteTokens(provider) {
    provider = canonicalProviderId(provider);
    const root = this.oauthRoot();
    delete root.tokens[provider];
    this.saveConfig();
  }

  status(provider) {
    provider = canonicalProviderId(provider);
    const settings = this.getProviderSettings(provider);
    const tokens = this.getTokens(provider);
    return {
      provider,
      configured: !!settings.clientId,
      connected: !!(tokens && tokens.refreshToken),
      expiresAt: tokens && tokens.expiresAt || null,
      updatedAt: tokens && tokens.updatedAt || null,
      scopes: tokens && tokens.scope ? String(tokens.scope).split(/\s+/).filter(Boolean) : [],
    };
  }
}

// Per-app token storage, scoped to config.settings.oauth.appTokens[appId].
// The clientId comes from the app manifest and is not user-configurable.
class AppTokenStorage {
  constructor({ appId, clientId, getConfig, saveConfig }) {
    this.appId = appId;
    this.clientId = String(clientId || '');
    this.getConfig = getConfig;
    this.saveConfig = saveConfig;
  }

  _root() {
    const config = this.getConfig();
    if (!config.settings) config.settings = {};
    if (!config.settings.oauth || typeof config.settings.oauth !== 'object') config.settings.oauth = { providers: {}, tokens: {}, appTokens: {} };
    if (!config.settings.oauth.appTokens || typeof config.settings.oauth.appTokens !== 'object') config.settings.oauth.appTokens = {};
    if (!config.settings.oauth.appTokens[this.appId] || typeof config.settings.oauth.appTokens[this.appId] !== 'object') config.settings.oauth.appTokens[this.appId] = { tokens: {} };
    if (!config.settings.oauth.appTokens[this.appId].tokens) config.settings.oauth.appTokens[this.appId].tokens = {};
    return config.settings.oauth.appTokens[this.appId];
  }

  // clientId is fixed from the app manifest; settings are not user-configurable.
  getProviderSettings(provider) { return { clientId: this.clientId, clientSecret: '' }; }
  setProviderSettings(provider, patch) { return this.getProviderSettings(provider); }

  getTokens(provider) {
    provider = canonicalProviderId(provider);
    const t = this._root().tokens[provider];
    return t && typeof t === 'object' ? Object.assign({}, t) : null;
  }

  setTokens(provider, tokens) {
    provider = canonicalProviderId(provider);
    const root = this._root();
    root.tokens[provider] = Object.assign({}, tokens || {}, { provider, updatedAt: Date.now() });
    this.saveConfig();
    return Object.assign({}, root.tokens[provider]);
  }

  deleteTokens(provider) {
    provider = canonicalProviderId(provider);
    const root = this._root();
    delete root.tokens[provider];
    this.saveConfig();
  }

  status(provider) {
    provider = canonicalProviderId(provider);
    const settings = this.getProviderSettings(provider);
    const tokens = this.getTokens(provider);
    return {
      provider,
      configured: !!settings.clientId,
      connected: !!(tokens && tokens.refreshToken),
      expiresAt: (tokens && tokens.expiresAt) || null,
      updatedAt: (tokens && tokens.updatedAt) || null,
      scopes: tokens && tokens.scope ? String(tokens.scope).split(/\s+/).filter(Boolean) : [],
    };
  }
}

module.exports = { TokenStorage, AppTokenStorage };
