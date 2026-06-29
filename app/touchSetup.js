'use strict';
/*
 * touchSetup.js — bind a touchscreen to its physical display on Windows. Wraps tabcal.exe (built
 * into System32) with elevation so the user just clicks "Set up touchscreen" instead of doing
 * the PowerShell archaeology Microsoft requires to find the right \\.\DISPLAY# name.
 *
 * The Tablet PC Settings → Setup UI was removed / broken in Win 11 24H2, and the underlying
 * \\.\DISPLAY# numbering is independent of the "Monitor 1/2/3" labels in Settings (it follows
 * Windows' internal enumeration order, not Settings' drag-reorderable layout). We bridge by
 * enumerating each \\.\DISPLAY#'s bounds via System.Windows.Forms.Screen and matching against
 * the Electron Display object open-quake already identifies as the panel (deviceDisplay()).
 *
 * No-op on macOS / Linux.
 */
const { spawn } = require('child_process');

// Enumerate Windows displays with their device name + bounds. Returns [] off Windows or on failure.
function enumDisplays() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    const ps = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { '{0}|{1}|{2}|{3}|{4}|{5}' -f $_.DeviceName, $_.Bounds.X, $_.Bounds.Y, $_.Bounds.Width, $_.Bounds.Height, $_.Primary }";
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.on('error', () => resolve([]));
    child.on('close', code => {
      if (code !== 0) return resolve([]);
      const rows = out.trim().split(/\r?\n/).map(line => {
        const parts = line.split('|');
        if (parts.length < 6) return null;
        return { deviceName: parts[0], x: +parts[1], y: +parts[2], width: +parts[3], height: +parts[4], primary: parts[5] === 'True' };
      }).filter(Boolean);
      resolve(rows);
    });
  });
}

// Given an Electron Display object (the panel), return the matching \\.\DISPLAY# name or null.
async function findDisplayId(panel) {
  if (!panel || !panel.bounds) return null;
  const b = panel.bounds;
  const rows = await enumDisplays();
  const hit = rows.find(r => r.x === b.x && r.y === b.y && r.width === b.width && r.height === b.height);
  return hit ? hit.deviceName : null;
}

// Spawn tabcal.exe elevated (one UAC prompt). The user then taps the crosshairs on the panel and
// Windows binds touch input to that display. We can't easily learn whether they completed the
// dialog — fire and forget. Returns immediately with what we kicked off.
function runTabcal(displayId) {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  if (!displayId) return { ok: false, error: 'no display id' };
  // Single-quoted PS strings are literal — backslashes in the DisplayID pass through verbatim.
  const ps = `Start-Process -FilePath tabcal.exe -ArgumentList 'LinCal','DisplayID=${displayId}' -Verb RunAs`;
  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, displayId };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// Clear stale calibration on every display so a fresh LinCal binds cleanly. Useful when the user
// has run setup before on the wrong display and the OS is holding onto that mapping.
function clearAllCalibrations() {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  // Build a chained command so one UAC prompt covers all the ClearCal calls.
  const ps = "Add-Type -AssemblyName System.Windows.Forms; $ids = [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $_.DeviceName }; $cmd = ($ids | ForEach-Object { 'tabcal.exe ClearCal DisplayID=' + $_ }) -join ' ; '; Start-Process powershell.exe -ArgumentList '-NoProfile','-Command',$cmd -Verb RunAs -WindowStyle Hidden";
  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

module.exports = { enumDisplays, findDisplayId, runTabcal, clearAllCalibrations };
