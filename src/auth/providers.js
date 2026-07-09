'use strict';

const REDIRECT_URI = 'http://localhost:5173/oauth/callback';

const providers = {
  teams: {
    id: 'teams',
    name: 'Microsoft Teams',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    revokeUrl: '',
    scopes: ['Presence.Read', 'Calendars.Read', 'offline_access'],
    redirectUri: REDIRECT_URI,
    usesPkce: true,
    accessTokenExpiresSkewMs: 5 * 60 * 1000,
  },
  github: {
    id: 'github',
    name: 'GitHub',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    revokeUrl: '',
    scopes: ['read:user'],
    redirectUri: REDIRECT_URI,
    usesPkce: true,
    accessTokenExpiresSkewMs: 5 * 60 * 1000,
  },
  google: {
    id: 'google',
    name: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    scopes: ['openid', 'email', 'profile'],
    redirectUri: REDIRECT_URI,
    usesPkce: true,
    accessTokenExpiresSkewMs: 5 * 60 * 1000,
  },
};

function providerFor(id) {
  return providers[String(id || '').toLowerCase()] || null;
}

module.exports = { REDIRECT_URI, providers, providerFor };
