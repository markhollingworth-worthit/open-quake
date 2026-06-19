'use strict';
/*
 * sysmetrics.js — live host metrics for the SystemView panel page (open-quake). [MIT]
 *
 * Pure data layer: polls `systeminformation` (no admin needed) on STAGGERED timers, plus
 * `nvidia-smi` (NVIDIA only) on its own off-loop timer, keeps ONE cached snapshot, and exposes
 * start() / stop() / getSnapshot().
 *
 * Design rules (see ../PROJECT.md and the plan):
 *  - REAL data only. Anything unavailable is `null` (NEVER 0) so the page renders "—".
 *  - Staggered loops + a per-loop re-entrancy guard so we don't spawn a powershell.exe storm
 *    (systeminformation shells out to PowerShell for several Windows metrics).
 *  - CPU temperature is unreadable without admin on Windows and returns junk → always null.
 *  - GPU temp/load only via nvidia-smi (no admin). Absent → null forever (AMD/Intel show "—").
 *  - `processes()` doesn't report "sleeping" on Windows → derive it (all − running − blocked).
 */
const si = require('systeminformation');
const { execFile } = require('child_process');
const path = require('path');

const STALE_MS = 10000;   // a metric group older than this is reported as null ("—")

// Each group holds the last value + the time it was last refreshed. ts=0 => never succeeded.
const groups = {
  cpu: { value: null, ts: 0 },
  mem: { value: null, ts: 0 },
  net: { value: null, ts: 0 },
  proc: { value: null, ts: 0 },
  battery: { value: null, ts: 0 },
  disks: { value: null, ts: 0 },
  gpuName: { value: null, ts: 0 },
  gpu: { value: null, ts: 0 },
};

const timers = [];
let running = false;
let gpuMode = 'unknown';            // 'unknown' | 'nvidia' | 'none'
let nvidiaBin = 'nvidia-smi';

function set(group, value) { groups[group].value = value; groups[group].ts = Date.now(); }
function fresh(group) { const g = groups[group]; return g.ts && (Date.now() - g.ts) < STALE_MS ? g.value : null; }
async function safe(fn) { try { return await fn(); } catch (e) { return undefined; } }

// Loop runner with a busy guard: if the previous tick's PowerShell call hasn't resolved, skip
// this tick rather than stacking processes. This is the main defense against the spawn storm.
function makeLoop(intervalMs, fn) {
  let busy = false;
  const tick = async () => {
    if (busy || !running) return;
    busy = true;
    try { await fn(); } catch (e) { /* keep last-good; staleness nulls it after STALE_MS */ }
    finally { busy = false; }
  };
  tick();                              // prime immediately
  timers.push(setInterval(tick, intervalMs));
}

// ---- fast loop (1s): CPU load, network throughput, memory ----
async function pollFast() {
  const [load, net, mem] = await Promise.all([
    safe(() => si.currentLoad()),
    safe(() => si.networkStats()),
    safe(() => si.mem()),
  ]);
  if (load && Number.isFinite(load.currentLoad)) set('cpu', { loadPct: load.currentLoad });
  if (Array.isArray(net)) {           // sum interfaces; only once we have real per-second deltas
    let rx = 0, tx = 0, have = false;
    for (const n of net) {
      if (Number.isFinite(n.rx_sec) && Number.isFinite(n.tx_sec)) { rx += n.rx_sec; tx += n.tx_sec; have = true; }
    }
    if (have) set('net', { rxBytesSec: rx, txBytesSec: tx });   // first call has null _sec → stays "—"
  }
  if (mem && Number.isFinite(mem.total)) {
    // "In use" matches Task Manager best as total − available; fall back to active, then used.
    const used = Number.isFinite(mem.available) ? (mem.total - mem.available)
      : Number.isFinite(mem.active) ? mem.active : mem.used;
    set('mem', { usedBytes: used, totalBytes: mem.total });
  }
}

// ---- medium loop (3s): processes, battery ----
async function pollMedium() {
  const [proc, batt] = await Promise.all([
    safe(() => si.processes()),
    safe(() => si.battery()),
  ]);
  if (proc && Number.isFinite(proc.all)) {
    const all = proc.all;
    const running_ = Number.isFinite(proc.running) ? proc.running : null;
    const blocked = Number.isFinite(proc.blocked) ? proc.blocked : 0;
    const sleeping = running_ != null ? Math.max(0, all - running_ - blocked) : null;   // Windows doesn't report it
    set('proc', { total: all, running: running_, blocked, sleeping });
  }
  if (batt) {
    if (batt.hasBattery) set('battery', { percent: Number.isFinite(batt.percent) ? batt.percent : null, charging: !!batt.isCharging });
    else set('battery', null);        // desktop: explicitly no battery (page hides the widget)
  }
}

// ---- slow loop (5s): per-drive disk, GPU name ----
async function pollSlow() {
  const [fs, gfx] = await Promise.all([
    safe(() => si.fsSize()),
    safe(() => si.graphics()),
  ]);
  if (Array.isArray(fs)) {
    const disks = fs
      .filter(d => d && d.size > 0 && /^[A-Za-z]:/.test(d.mount || d.fs || ''))
      .map(d => ({
        mount: (d.mount || d.fs || '').slice(0, 2),
        usedBytes: d.used,
        totalBytes: d.size,
        usePct: Number.isFinite(d.use) ? d.use : (d.size ? (d.used / d.size) * 100 : null),
      }));
    if (disks.length) set('disks', disks);
  }
  if (gfx && Array.isArray(gfx.controllers) && gfx.controllers.length) {
    const c = gfx.controllers.slice().sort((a, b) => (b.vram || 0) - (a.vram || 0))[0];   // most-vram = primary/discrete
    set('gpuName', c.model || c.name || c.vendor || null);
  }
}

// ---- GPU loop (2s): generic LOAD for all vendors via Windows perf counters (no admin), plus
// NVIDIA temp/mem via nvidia-smi when present. AMD/Intel temperature needs a vendor SDK → stays "—". ----
function execFileP(file, args, timeout) {
  return new Promise(resolve => execFile(file, args, { windowsHide: true, timeout: timeout || 1500 }, (err, stdout) => resolve(err ? null : stdout)));
}
function nvidiaQuery(args) { return execFileP(nvidiaBin, args, 1500); }

// Same GPU-Engine data Task Manager shows, aggregated Task-Manager-style as the max engine-type sum.
// We use Get-CimInstance (WMI), NOT Get-Counter: Get-Counter's PDH backend HANGS when the powershell
// child is spawned hidden (verified). Passed as -EncodedCommand (base64 UTF-16LE) so the spaces/quotes
// can't be mangled by Windows arg-splitting, and -InputFormat None so it never blocks on the piped stdin.
const GPU_LOAD_PS =
  "$ProgressPreference='SilentlyContinue';"
  + "$g=Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -EA SilentlyContinue;"
  + "if($g){[math]::Round((($g|Group-Object {($_.Name -split 'engtype_')[-1]}|"
  + "ForEach-Object{($_.Group|Measure-Object UtilizationPercentage -Sum).Sum}|Measure-Object -Maximum).Maximum),1)}";
const GPU_LOAD_B64 = Buffer.from(GPU_LOAD_PS, 'utf16le').toString('base64');
async function gpuLoadGeneric() {
  const out = await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-EncodedCommand', GPU_LOAD_B64], 6000);
  if (!out) return null;
  const n = parseFloat(String(out).trim().split(/\r?\n/)[0]);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

async function detectNvidia() {
  // Try the binary on PATH, then the driver's default System32 location.
  const fallback = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe');
  for (const bin of ['nvidia-smi', fallback]) {
    nvidiaBin = bin;
    const out = await nvidiaQuery(['--query-gpu=name', '--format=csv,noheader']);
    if (out && out.trim()) return 'nvidia';
  }
  return 'none';
}

async function pollGpu() {
  let tempC = null, loadPct = await gpuLoadGeneric(), memPct = null;   // generic load: all vendors, no admin
  if (gpuMode === 'nvidia') {                                          // NVIDIA: real temp + more-accurate load + mem
    const out = await nvidiaQuery(['--query-gpu=temperature.gpu,utilization.gpu,utilization.memory', '--format=csv,noheader,nounits']);
    if (out) {
      const parts = out.trim().split('\n')[0].split(',').map(s => parseInt(s.trim(), 10));
      if (parts.length >= 3 && parts.every(Number.isFinite)) { tempC = parts[0]; loadPct = parts[1]; memPct = parts[2]; }
    }
  }
  if (loadPct != null || tempC != null) set('gpu', { tempC, loadPct, memPct });
}

// ---- public API ----
async function start() {
  if (running) return;
  running = true;
  makeLoop(1000, pollFast);
  makeLoop(3000, pollMedium);
  makeLoop(5000, pollSlow);
  gpuMode = await detectNvidia();                    // for temp/mem; GPU LOAD is generic (works on all vendors)
  if (running) makeLoop(3000, pollGpu);              // 3s: the CIM query takes ~2.4s, give it breathing room
}

function stop() {
  running = false;
  while (timers.length) clearInterval(timers.pop());
}

function getSnapshot() {
  const cpu = fresh('cpu'), gpu = fresh('gpu'), gpuName = fresh('gpuName');
  return {
    ts: Date.now(),
    cpu: { loadPct: cpu ? cpu.loadPct : null, tempC: null },          // CPU temp: not readable no-admin → always "—"
    gpu: {
      name: gpuName || null,
      tempC: gpu ? gpu.tempC : null,
      loadPct: gpu ? gpu.loadPct : null,
      memPct: gpu ? gpu.memPct : null,
      available: gpuMode === 'nvidia',
    },
    mem: fresh('mem'),
    disks: fresh('disks'),
    net: fresh('net'),
    battery: fresh('battery'),
    proc: fresh('proc'),
  };
}

module.exports = { start, stop, getSnapshot };
