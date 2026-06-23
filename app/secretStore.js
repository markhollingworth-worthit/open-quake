'use strict';
// Encrypt the secret-typed config fields at rest in config.json using Electron `safeStorage`
// (macOS Keychain-backed). Secrets stay PLAINTEXT in the in-memory config — they are only
// (de)serialized at the disk boundary. Dependency-injected so it unit-tests without Electron.
//
// Secret fields walked by encryptConfig/decryptConfig/hasPlaintextSecret:
//   web grids (g.kind === 'web' && g.auth):
//     auth.type === 'ha'     -> auth.token
//     auth.type === 'basic'  -> auth.pass            (NOT auth.user)
//     auth.type === 'header' -> auth.headers[i].value (NOT auth.headers[i].name)
//   app grids (g.kind === 'app'): each option key whose schema type is 'secret' (apps.json).
//   settings:
//     settings.spotify.refreshToken                   (NOT settings.spotify.clientId — clientId is public)
const MARKER = 'oqenc:v1:';

function createSecretStore({ safeStorage, loadApps, log = () => {} }) {
  // safeStorage is only usable after the Electron app is ready; treat any throw as "unavailable".
  function available() {
    try { return !!(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()); }
    catch { return false; }
  }

  // Encrypt one value for at-rest storage. Idempotent (already-marked values pass through), and a
  // no-op for non-strings / empty strings. Falls back to plaintext (caller logs) when unavailable.
  function encryptValue(plain) {
    if (typeof plain !== 'string' || plain === '') return plain;
    if (plain.startsWith(MARKER)) return plain;              // already encrypted — don't double-wrap
    if (!available()) return plain;                          // fallback: store plaintext (logged by saveConfig path)
    return MARKER + safeStorage.encryptString(plain).toString('base64');
  }

  // Decrypt one stored value. Plaintext (unmarked) values pass through unchanged — this is also the
  // migration path: a pre-encryption config decrypts to itself. A decrypt failure logs and preserves
  // the marked ciphertext, so a later save does not erase the user's secret.
  function decryptValue(stored) {
    if (typeof stored !== 'string' || !stored.startsWith(MARKER)) return stored;
    try { return safeStorage.decryptString(Buffer.from(stored.slice(MARKER.length), 'base64')); }
    catch (e) { log('secret decrypt failed: ' + e.message); return stored; }
  }

  // The option keys an app declares as type:'secret' in apps.json (e.g. Open WebUI api_key).
  function secretKeysForApp(appId) {
    const def = (loadApps() || []).find(a => a && a.id === appId);
    if (!def || !Array.isArray(def.options)) return [];
    return def.options.filter(o => o && o.type === 'secret').map(o => o.key);
  }

  // Apply `fn` to exactly the secret fields of `g`, in place (g is a clone supplied by the callers).
  function transformGridSecrets(g, fn) {
    if (!g || typeof g !== 'object') return;
    if (g.kind === 'web' && g.auth && typeof g.auth === 'object') {
      const a = g.auth;
      if (a.type === 'ha') a.token = fn(a.token);
      else if (a.type === 'basic') a.pass = fn(a.pass);     // user stays plaintext
      else if (a.type === 'header' && Array.isArray(a.headers)) {
        a.headers.forEach(h => { if (h && typeof h === 'object') h.value = fn(h.value); });   // name stays plaintext
      }
    } else if (g.kind === 'app') {
      const opts = g.options;
      if (opts && typeof opts === 'object') {
        secretKeysForApp(g.app).forEach(key => {
          if (key in opts) opts[key] = fn(opts[key]);
        });
      }
    }
  }

  // Apply `fn` to exactly the secret fields under config.settings, in place (config is a clone supplied
  // by the callers). Currently: settings.spotify.refreshToken (clientId is PUBLIC and stays plaintext).
  function transformSettingsSecrets(config, fn) {
    const sp = config && config.settings && config.settings.spotify;
    if (sp && typeof sp === 'object' && typeof sp.refreshToken === 'string' && sp.refreshToken !== '') {
      sp.refreshToken = fn(sp.refreshToken);
    }
  }

  // Walk every secret field of `g`; true if any holds a non-empty, not-yet-encrypted string.
  function gridHasPlaintextSecret(g) {
    let found = false;
    transformGridSecrets(g, v => {
      if (typeof v === 'string' && v !== '' && !v.startsWith(MARKER)) found = true;
      return v;
    });
    return found;
  }

  // Both operate on a structuredClone — the input config is never mutated.
  function encryptConfig(config) {
    const clone = structuredClone(config);
    (clone && Array.isArray(clone.grids) ? clone.grids : []).forEach(g => transformGridSecrets(g, encryptValue));
    transformSettingsSecrets(clone, encryptValue);
    return clone;
  }
  function decryptConfig(config) {
    const clone = structuredClone(config);
    (clone && Array.isArray(clone.grids) ? clone.grids : []).forEach(g => transformGridSecrets(g, decryptValue));
    transformSettingsSecrets(clone, decryptValue);
    return clone;
  }
  function hasPlaintextSecret(config) {
    if ((config && Array.isArray(config.grids) ? config.grids : []).some(gridHasPlaintextSecret)) return true;
    let found = false;
    transformSettingsSecrets(structuredClone(config || {}), v => {
      if (typeof v === 'string' && v !== '' && !v.startsWith(MARKER)) found = true;
      return v;
    });
    return found;
  }

  return {
    MARKER,
    available,
    encryptValue,
    decryptValue,
    secretKeysForApp,
    encryptConfig,
    decryptConfig,
    hasPlaintextSecret,
  };
}

module.exports = { createSecretStore, MARKER };
