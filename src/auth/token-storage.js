'use strict';

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
    return config.settings.oauth;
  }

  getProviderSettings(provider) {
    const root = this.oauthRoot();
    return Object.assign({}, root.providers[provider] || {});
  }

  setProviderSettings(provider, patch) {
    const root = this.oauthRoot();
    root.providers[provider] = Object.assign({}, root.providers[provider] || {}, patch || {});
    this.saveConfig();
    return Object.assign({}, root.providers[provider]);
  }

  getTokens(provider) {
    const root = this.oauthRoot();
    const t = root.tokens[provider];
    return t && typeof t === 'object' ? Object.assign({}, t) : null;
  }

  setTokens(provider, tokens) {
    const root = this.oauthRoot();
    root.tokens[provider] = Object.assign({}, tokens || {}, { provider, updatedAt: Date.now() });
    this.saveConfig();
    return Object.assign({}, root.tokens[provider]);
  }

  deleteTokens(provider) {
    const root = this.oauthRoot();
    delete root.tokens[provider];
    this.saveConfig();
  }

  status(provider) {
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

module.exports = { TokenStorage };
