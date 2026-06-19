'use strict';
/*
 * nowplaying.js — current "now playing" track from the Windows System Media Transport Controls
 * (SMTC / Windows.Media.Control WinRT), read via PowerShell. [MIT]
 *
 * App-agnostic: whatever app feeds the OS media flyout (Spotify, browser media, Groove, …) shows up
 * here — title / artist / album / playback status. No admin, no native dependency.
 *
 * NOTE: album art is intentionally NOT included. The SMTC thumbnail is a WinRT stream that Windows
 * PowerShell 5.1 returns as an unprojected COM object (can't read its bytes), so artwork needs a small
 * bundled .NET helper — a planned follow-up. Transport control is handled in main.js via media keys.
 *
 * The PowerShell is passed as -EncodedCommand (base64 UTF-16LE) so its quotes/backticks can't be
 * mangled by Windows arg-splitting, with -InputFormat None so it never blocks on the piped stdin.
 */
const { execFile } = require('child_process');

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

function poll() {
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
  if (busy || !running) return;     // busy guard: don't stack PowerShell spawns
  busy = true;
  try { const r = await poll(); if (r) { snapshot = r; snapTs = Date.now(); } } catch (e) {}
  finally { busy = false; }
}

function start() { if (running) return; running = true; tick(); timer = setInterval(tick, 2500); }
function stop() { running = false; if (timer) clearInterval(timer); timer = null; }
function getSnapshot() { return (snapTs && Date.now() - snapTs < STALE_MS) ? snapshot : null; }   // null => "nothing playing"

module.exports = { start, stop, getSnapshot };
