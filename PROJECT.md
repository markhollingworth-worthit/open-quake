# PROJECT — SystemView (open-quake system-monitor app)

A live PC system-performance dashboard for the DK-QUAKE panel — CPU/GPU, memory,
disk, network, battery, and process state — styled for the 1920×480 screen.

## Charter

**1. What is the one thing this must do?**
Show the **real, live state of this PC** on the panel — CPU & GPU load (and temp
where available), RAM used/total, per-drive disk usage, network up/down, battery %,
and process counts (running/blocked/sleeping) — refreshing continuously (~1 s).

**2. What would be wrong if we shipped "working" software without it?**
The numbers must be **real and live**. A beautiful dashboard showing static, fake,
or `0`/placeholder values (like the source mockup's `0°C` / `0%`) is a failure — it
must reflect what Task Manager / Resource Monitor would show, and update on its own.

**3. What is explicitly off-limits as a workaround?**
- No fake, hardcoded, or placeholder metrics — every value is read from the host.
- No making the user type in their specs or hand-edit a data file.
- No unsafe sandbox break — we do **not** turn on `nodeIntegration` for dashboards;
  metrics reach the page through a controlled local feed, not host access in the webview.
- Core metrics must work **without admin rights**. (CPU/GPU temperature may be
  best-effort — see success criteria — but load/RAM/disk/net/battery/processes must not
  require elevation.)

**4. Deployment target and backup location?**
- Target: bundled into **open-quake** (Windows), shown on the DK-QUAKE panel.
- Backup: the git repo at `D:\Github\open-quake` (snapshots cover it).

**5. How will we verify it's done?**
On the panel, SystemView shows and continuously updates:
- CPU load %, RAM used/total, per-drive disk usage, network up/down, battery %,
  process counts — each matching Task Manager / Resource Monitor within reason.
- CPU/GPU **temperature**: real values where the OS/driver exposes them (e.g. NVIDIA
  via `nvidia-smi`), and a graceful **"—"** where they aren't, never a fake `0°C`.
- Survives being left up for minutes without stalling, leaking, or freezing the panel.

## Proposed approach (needs sign-off)

The app/dashboard webview is sandboxed (no host access by design), so the page can't
read system metrics itself. Plan:

1. **Metrics provider** in the main process using the [`systeminformation`](https://www.npmjs.com/package/systeminformation)
   package (pure-JS for the core metrics; no native rebuild). Add as a dependency.
2. **Tiny localhost server** in main that serves the SystemView page **and** a live
   `/metrics` JSON (or SSE) feed on `127.0.0.1`.
3. SystemView is shown as a **dashboard page** pointed at that localhost URL — reusing
   the existing web-view model; no new privileged-webview code.
4. **Temps are best-effort**: try `nvidia-smi` (NVIDIA GPU) and `systeminformation`'s
   CPU temp; show "—" when unavailable rather than blocking the rest.

## Open decisions for sign-off
- **Metric set** above — add/drop anything? (mockup also shows a per-process Run/Block/Sleep donut.)
- **Temps**: ship best-effort now (real where available, "—" otherwise), or invest in a
  bundled helper (LibreHardwareMonitor) for fuller temp coverage later?
- **Port**: fixed local port (simplest) with a fallback if taken — OK?
- Adding the `systeminformation` dependency to the repo — OK?
