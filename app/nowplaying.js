'use strict';
/*
 * nowplaying.js — current "now playing" track from the Windows System Media Transport Controls
 * (SMTC / Windows.Media.Control WinRT), read via PowerShell. [MIT]
 *
 * App-agnostic: whatever app feeds the OS media flyout (Spotify, browser media, Groove, …) shows up
 * here — title / artist / album / playback status. No admin, no native dependency.
 *
 * Album art: the SMTC thumbnail is a WinRT stream Windows PowerShell 5.1 can't read (it returns an
 * unprojected COM object), so a tiny bundled .NET helper (native/smtc-art.cs -> app/native/smtc-art.exe)
 * reads it natively; we run it once per track and cache the result. Transport control is in main.js.
 *
 * The PowerShell is passed as -EncodedCommand (base64 UTF-16LE) so its quotes/backticks can't be
 * mangled by Windows arg-splitting, with -InputFormat None so it never blocks on the piped stdin.
 */
const { execFile } = require('child_process');
const { net } = require('electron');
const path = require('path');

const SMTC_PS = [
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime;",
  "$a=([System.WindowsRuntimeSystemExtensions].GetMethods()|?{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0];",
  "function Await($t,$r){$m=$a.MakeGenericMethod($r);$n=$m.Invoke($null,@($t));$n.Wait(-1)|Out-Null;$n.Result}",
  "[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]|Out-Null;",
  "$mgr=Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]);",
  "$c=$mgr.GetCurrentSession();",
  "if($c){$p=Await ($c.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]);$i=$c.GetPlaybackInfo();[pscustomobject]@{title=$p.Title;artist=$p.Artist;album=$p.AlbumTitle;status=$i.PlaybackStatus.ToString();app=$c.SourceAppUserModelId}|ConvertTo-Json -Compress}"
].join('');
const SMTC_B64 = Buffer.from(SMTC_PS, 'utf16le').toString('base64');

const STALE_MS = 12000;   // if no session refresh for this long, report null
let snapshot = null, snapTs = 0, timer = null, running = false, busy = false;

// Optional async now-playing provider (e.g. the Spotify Web API client on macOS). When set, it REPLACES
// the win32 SMTC poll: macOS-with-Spotify -> provider; win32 -> SMTC; otherwise null. A provider result
// carries its own `art` URL (the page's setArt takes a URL), so it bypasses the SMTC art-helper path.
let provider = null;
function setProvider(fn) { provider = (typeof fn === 'function') ? fn : null; }

// Album art via the bundled .NET helper. Path resolves dev vs packaged (asar.unpacked) like main.js.
const ART_EXE = path.join(__dirname, 'native', 'smtc-art.exe').replace('app.asar', 'app.asar.unpacked');
const artCache = {};      // trackKey -> dataURL | null  (fetched or failed; never re-fetched)
let artBusy = false;
function trackKey(s) { return s ? (s.title || '') + '\t' + (s.artist || '') : ''; }
function artMime(b64) {   // sniff the format from the base64 head so the data: URL declares the right type
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('R0lGOD')) return 'image/gif';
  if (b64.startsWith('UklGR')) return 'image/webp';
  if (b64.startsWith('Qk')) return 'image/bmp';
  return 'image/png';
}
function fetchArt(key, track) {
  if (artBusy || (key in artCache)) return;   // one fetch at a time; never re-fetch a known track
  artBusy = true;
  if (process.platform !== 'win32') {   // smtc-art.exe is Windows-only — skip it, go straight to the iTunes fallback
    lookupArtOnline(track, url => { artCache[key] = url || null; artBusy = false; });
    return;
  }
  execFile(ART_EXE, [], { windowsHide: true, timeout: 4000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
    const b64 = (!err && stdout) ? String(stdout).trim() : '';
    if (b64) { artCache[key] = 'data:' + artMime(b64) + ';base64,' + b64; artBusy = false; return; }
    lookupArtOnline(track, url => { artCache[key] = url || null; artBusy = false; });   // helper had no art -> online fallback
  });
}
// Fallback cover art via Apple's iTunes Search API (no key) when the SMTC thumbnail is unavailable —
// the helper is missing/blocked, or the player reports a track but ships no embedded art. Sends only the
// artist + album/title to Apple, and only for tracks the helper couldn't cover.
function lookupArtOnline(track, cb) {
  const artist = (track && track.artist) || '';
  const what = (track && (track.album || track.title)) || '';
  const term = (artist + ' ' + what).trim();
  if (!term) return cb(null);
  const url = 'https://itunes.apple.com/search?limit=1&media=music&entity='
    + ((track && track.album) ? 'album' : 'song') + '&term=' + encodeURIComponent(term);
  let req, to, done = false;
  const finish = v => { if (done) return; done = true; if (to) clearTimeout(to); cb(v); };
  try { req = net.request(url); } catch (e) { return cb(null); }
  to = setTimeout(() => { try { req.abort(); } catch (e) {} finish(null); }, 4000);
  const chunks = [];
  req.on('error', () => finish(null));
  req.on('response', resp => {
    if (resp.statusCode !== 200) { resp.resume(); return finish(null); }
    resp.on('data', d => chunks.push(d));
    resp.on('error', () => finish(null));
    resp.on('end', () => {
      try {
        const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const a = j.results && j.results[0] && j.results[0].artworkUrl100;
        finish(a ? a.replace('100x100bb', '600x600bb') : null);   // bump 100px thumb to 600px
      } catch (e) { finish(null); }
    });
  });
  req.end();
}

function poll() {
  if (provider) return Promise.resolve().then(provider).catch(() => null);   // injected source (Spotify) replaces SMTC
  if (process.platform !== 'win32') return Promise.resolve(null);   // SMTC is Windows-only; never spawn powershell elsewhere
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-EncodedCommand', SMTC_B64],
      { windowsHide: true, timeout: 6000 }, (err, stdout) => {
        if (err || !stdout || !stdout.trim()) return resolve(null);   // no session / error
        try {
          const o = JSON.parse(stdout.trim());
          resolve({ title: o.title || null, artist: o.artist || null, album: o.album || null, status: o.status || null, app: o.app || null });
        } catch (e) { resolve(null); }
      });
  });
}

async function tick() {
  if (busy || !running) return;     // busy guard: don't stack PowerShell spawns / overlap provider calls
  busy = true;
  try {
    const r = await poll();
    if (r) {
      snapshot = r; snapTs = Date.now();
      // A provider (Spotify) supplies its own art URL — cache it directly and skip the SMTC art helper
      // (smtc-art.exe / iTunes lookup). The SMTC path still resolves art asynchronously via fetchArt.
      if ('art' in r) artCache[trackKey(r)] = r.art || null;
      else if (running) fetchArt(trackKey(r), r);
    }
  } catch (e) {}
  finally { busy = false; }
}

function start() { if (running) return; running = true; tick(); timer = setInterval(tick, 2500); }
function stop() { running = false; if (timer) clearInterval(timer); timer = null; artBusy = false; for (const k in artCache) delete artCache[k]; }
function getSnapshot() {                                                    // null => "nothing playing"
  if (!(snapTs && Date.now() - snapTs < STALE_MS)) return null;
  const k = trackKey(snapshot);
  return Object.assign({}, snapshot, { art: (k in artCache) ? artCache[k] : null });
}

module.exports = { start, stop, getSnapshot, setProvider };
