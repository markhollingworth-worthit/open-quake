'use strict';
/*
 * desktopFocus.js — track the PC's foreground (focused) application and let the panel
 * auto-switch to a page mapped to it. [MIT]
 *
 * Windows-only. Two operations:
 *   - getForegroundProcessName() — P/Invoke GetForegroundWindow + GetWindowThreadProcessId,
 *     same technique already proven in meetingControl.js's Teams-focus script, but reading
 *     instead of setting. Returns a bare process name (no ".exe"), matching Get-Process's own
 *     .ProcessName convention (and meetingControl.js's Get-Process -Name usage).
 *   - listRunningApps() — Get-Process | Where-Object MainWindowTitle, for the editor's
 *     "browse running apps" picker. Same "does this process own a real window" signal
 *     meetingControl.js already uses to find Teams' window, generalized to all processes.
 *
 * Polling, not an event hook (SetWinEventHook) — simplest option, consistent with this
 * codebase's other pollers (nowplaying.js's SMTC read), "good enough" latency at ~1.5s.
 * Only fires onChange on a COMMITTED transition: the new process must be stable across two
 * consecutive polls (~3s) before it's reported. This is what keeps rapid alt-tabbing from
 * causing page-switch flicker, and (since committed state only updates on genuine change)
 * is also what keeps the poller from ever fighting a manual page navigation on its own —
 * it has nothing to re-assert while the same app stays focused.
 */
const { execFile } = require('child_process');

const FOREGROUND_PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class OqFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
$hWnd = [OqFg]::GetForegroundWindow()
$procId = 0
[OqFg]::GetWindowThreadProcessId($hWnd, [ref]$procId) | Out-Null
try { (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { '' }
`.trim();

const LIST_APPS_PS = `
Get-Process | Where-Object { $_.MainWindowTitle } |
  Select-Object -Property ProcessName, MainWindowTitle -Unique |
  ConvertTo-Json -Compress
`.trim();

function runPs(script, timeoutMs) {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: timeoutMs || 4000 }, (err, stdout) => {
        if (err) return resolve(null);
        resolve(String(stdout || '').trim());
      });
  });
}

async function getForegroundProcessName() {
  const out = await runPs(FOREGROUND_PS, 3000);
  return out || null;
}

// [{ processName, title }], deduped by processName (a process can own several windows —
// e.g. multiple Chrome windows — each with a different title; keep one representative title).
async function listRunningApps() {
  const out = await runPs(LIST_APPS_PS, 5000);
  if (!out) return [];
  let rows;
  try { rows = JSON.parse(out); } catch (e) { return []; }
  if (!Array.isArray(rows)) rows = [rows];   // ConvertTo-Json emits a bare object, not a 1-item array, for a single result
  const seen = new Set();
  const out2 = [];
  for (const r of rows) {
    const name = r && r.ProcessName;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out2.push({ processName: name, title: r.MainWindowTitle || '' });
  }
  out2.sort((a, b) => a.processName.localeCompare(b.processName));
  return out2;
}

const DEBOUNCE_POLLS = 2;   // consecutive polls the new process must hold before it's reported
const POLL_MS = 1500;

let running = false, timer = null, busy = false;
let committed = null;             // the last process name actually reported to onChange
let pendingName = null, pendingCount = 0;
let onChange = null;

async function tick() {
  if (busy || !running) return;
  busy = true;
  try {
    const name = await getForegroundProcessName();
    if (!name || name === committed) {
      pendingName = null; pendingCount = 0;   // back to the committed app (or unreadable) -> cancel any pending change
      return;
    }
    if (name === pendingName) {
      pendingCount++;
      if (pendingCount >= DEBOUNCE_POLLS) {
        committed = name;
        pendingName = null; pendingCount = 0;
        if (onChange) onChange(name);
      }
    } else {
      pendingName = name; pendingCount = 1;
    }
  } catch (e) {}
  finally { busy = false; }
}

/** cb(processName) fires on each committed (debounced) foreground-process change. */
function start(cb) {
  onChange = cb;
  if (running) return;
  running = true;
  tick();
  timer = setInterval(tick, POLL_MS);
}
function stop() {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
  committed = null; pendingName = null; pendingCount = 0;
}

/** The last debounced/committed foreground process name (what onChange most recently fired with), or null. */
function getCommittedProcess() { return committed; }

module.exports = { start, stop, getForegroundProcessName, listRunningApps, getCommittedProcess };
