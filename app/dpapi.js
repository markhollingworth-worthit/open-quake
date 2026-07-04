'use strict';
/*
 * dpapi.js — raw Windows DPAPI (CryptProtectData/CryptUnprotectData, CurrentUser scope) via
 * PowerShell's [Security.Cryptography.ProtectedData]. The at-rest secret backend on Windows
 * (secretStore.js `oqenc:v2:` values), replacing Electron safeStorage.
 *
 * Why not safeStorage: its Chromium OSCrypt layer wraps one random AES key in DPAPI and keeps it
 * in the profile's Local State — and in this app that key proved session-local in practice (real
 * launches encrypted with a key no later launch could recover, silently orphaning every stored
 * secret; diagnosed 2026-07-03). Raw DPAPI has no key file at all: each value is independently
 * protected by the user's Windows credentials. Same security boundary (same-user DPAPI at the
 * bottom of both chains), none of the key-lifecycle fragility.
 *
 * Secrets cross to PowerShell via stdin and come back via stdout (base64) — never argv, which any
 * same-user process can read from the process list.
 *
 * Both directions are memoized, and a decrypt seeds the encrypt cache with the original blob — so
 * steady-state saveConfig() calls (knob page-switch persistence, counter ticks) re-save unchanged
 * secrets byte-identical without ever spawning a shell. Only a genuinely new/changed secret pays
 * the ~300 ms spawn, once.
 */
const { spawnSync } = require('child_process');

// One script per direction; input and output are JSON arrays of base64 (bytes in, bytes out).
const PS = mode => `
Add-Type -AssemblyName System.Security
$vals = [Console]::In.ReadToEnd() | ConvertFrom-Json
$out = @(@($vals) | ForEach-Object {
  try { [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${mode}([Convert]::FromBase64String($_), $null, 'CurrentUser')) }
  catch { '' }
})
ConvertTo-Json -Compress -InputObject $out
`.trim();

function runBatch(mode, b64s) {
  if (process.platform !== 'win32' || !b64s.length) return b64s.map(() => '');
  let out;
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS(mode)],
      { input: JSON.stringify(b64s), windowsHide: true, timeout: 15000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (r.error || r.status !== 0) return b64s.map(() => '');
    out = JSON.parse(String(r.stdout || '').trim());
  } catch (e) { return b64s.map(() => ''); }
  if (!Array.isArray(out)) out = [out];   // ConvertTo-Json can emit a bare string for one item
  return b64s.map((_, i) => (typeof out[i] === 'string' ? out[i] : ''));
}

const encCache = new Map();   // plaintext -> blob (base64)
const decCache = new Map();   // blob (base64) -> plaintext

/** Encrypt one utf8 string -> DPAPI blob (base64), or null on failure. */
function protectOne(plain) {
  if (encCache.has(plain)) return encCache.get(plain);
  const [blob] = runBatch('Protect', [Buffer.from(plain, 'utf8').toString('base64')]);
  if (!blob) return null;
  encCache.set(plain, blob); decCache.set(blob, plain);
  return blob;
}

/** Decrypt one DPAPI blob (base64) -> utf8 string, or null on failure. */
function unprotectOne(blob) {
  if (decCache.has(blob)) return decCache.get(blob);
  const [plainB64] = runBatch('Unprotect', [blob]);
  if (!plainB64) return null;
  const plain = Buffer.from(plainB64, 'base64').toString('utf8');
  decCache.set(blob, plain); encCache.set(plain, blob);
  return plain;
}

let availCache = null;
/** Cached one-time probe: can this machine DPAPI-protect right now? */
function available() {
  if (process.platform !== 'win32') return false;
  if (availCache === null) availCache = protectOne('oq-dpapi-probe') !== null;
  return availCache;
}

module.exports = { protectOne, unprotectOne, available };
