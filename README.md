# open-quake

An open driver and touchscreen launcher for the **DK-QUAKE / ARIS-68** — the
1920×480 touchscreen-plus-knob macro device (sold with the closed-source
DK-Suite app). `open-quake` talks to it directly over HID, with no vendor
software running.

![open-quake on the DK-QUAKE](docs/showcase.png)

*From top: the grid launcher · a merged-tile Media grid · the flip-clock app · a [Windy](https://www.windy.com) weather map and a [Home Assistant](https://www.home-assistant.io) dashboard — each with the knob's RGB ring lit a different color.*

### **[⬇ Download for Windows](https://github.com/TeeJS/open-quake/releases/)** &nbsp;·&nbsp; or build from source (below)

> **Switching pages:** the panel shows one page at a time — **double-click the knob** to open the page selector, rotate to highlight a page, then press to switch. open-quake shows this tip right on the panel the first time you launch it.

It gives you:

- **A multi-grid launcher** — each page is a grid of tiles; tap a tile — or click it
  with your PC mouse — to open an app, URL, shell command, file, a system action
  (lock screen), or jump straight to another open-quake page. A tile's icon can be
  an emoji, the program's own icon, or a custom image.
- **Web dashboard pages** — a page can instead be a live web view (Home Assistant,
  Grafana / server monitoring, a status page, …) shown full-screen on the panel:
  the knob scrolls it, a tap clicks, and logins persist across restarts. Pages that
  need auth can inject a Home Assistant long-lived token, HTTP Basic Auth, or custom
  header(s) (bearer / Cloudflare Access) — set per page in the editor.
- **Knob control** — rotate for volume (or to scroll the current dashboard),
  single-click to mute, **double-click to open the page selector** (rotate to
  pick a page by name, press to switch). The **RGB ring** around the knob is
  configurable — color, effect, brightness, and speed (see [Settings](#settings--knob-lighting)).
- **A PC-side editor** — build pages of tiles (each opens an app / URL / shell
  command / file, a system action, or another page) with an emoji, app, or image icon; **merge**
  adjacent tiles into one larger button; **drag-and-drop** to rearrange; then
  **Save** to push to the panel.
- **Settings** — choose how the app starts (editor window, minimized, or tray-only),
  **auto-rotate** the panel through your pages on a timer, toggle the on-board mic, and
  tune the knob's ring lighting — from the editor's **⚙ Settings** page. open-quake also
  lives in the system tray for quick toggles.
- **A system monitor** — a built-in **System Monitor** page shows your PC's live CPU/GPU load,
  memory, per-drive disk, network, and process count on the panel (see
  [System monitor](#system-monitor-systemview)).

> **Status:** early. Touch, knob (incl. the RGB ring), grids, merged buttons, web
> dashboards, the on-board mic, and the editor are working and validated against real
> hardware. The panel is driven as a normal external monitor (Windows sees a 480×1920 /
> 1920×480 display); pushing frames over the HID resource channel is not implemented.

## Download

Grab a build from the **[Releases](https://github.com/TeeJS/open-quake/releases)** page (Windows x64):
- **`open-quake-<version>-portable.exe`** — run directly, no install.
- **`open-quake-<version>-setup.exe`** — installer (Start-menu shortcut + uninstaller).

The exe is **code-signed** (Azure Trusted Signing, publisher *Thomas Schmitz*) — so you see a
verified publisher, not "Unknown publisher." Windows SmartScreen may still show a **"Windows
protected your PC"** prompt on first download; that's reputation-based (it eases as a release
gains downloads), not a problem with the file. Confirm the publisher reads **Thomas Schmitz**,
then click **More info → Run anyway**. Plug in the DK-QUAKE, then launch; config is stored in
`%APPDATA%\open-quake`. (Linux/macOS builds would need platform-specific launch/volume work —
not done yet.)

## Hardware

The DK-QUAKE's screen is a standard external monitor (HDMI or USB-C DisplayPort
alt-mode) recognized by Windows as a 480×1920 portrait display. A separate USB
link handles touch and control/knob/mic interfaces. Video travels over the
display cable; open-quake renders an Electron window onto that monitor, exactly
as DK-Suite did. Unplug the display cable and the panel goes dark, but the USB
side keeps working.

The USB side is two HID interfaces: a control interface (knob, mic/state,
firmware, keep-alive) and a multi-touch interface. The panel ships dark and
idle-blanks; the driver wakes it and sends a periodic keep-alive so it stays on.
The on-board mic enumerates as a standard **"5- USB PnP Audio Device"** — any app
can read it directly; `open-quake` doesn't wrap it.

## Dashboards

A page can be a web view instead of a tile grid (**+ Dashboard** in the editor —
give it a name + URL). It renders full-screen on the panel; the knob scrolls it
(inner scroll panels included), a tap is a click, and double-clicking the knob
returns to the page selector. Sessions persist across restarts. open-quake ships
with a public **[Windy](https://www.windy.com) weather map** as a ready-made
dashboard example.

**Auth** is set per page in the editor — needed because the panel has no keyboard:

| Type | For |
|---|---|
| **None** | public / anonymous pages (Flipboard, anonymous Grafana) |
| **Home Assistant token** | HA — paste a Long-Lived Access Token; the panel seeds it and loads signed-in |
| **HTTP Basic Auth** | sites behind a real `401` / `WWW-Authenticate: Basic` challenge (e.g. nginx `auth_basic`) |
| **Custom header(s)** | bearer tokens, Grafana service accounts, Cloudflare Access (`CF-Access-Client-Id` / `-Secret`) |

**Form-login apps** — which redirect to a `/login` *page* instead of issuing a
`401` — aren't covered by Basic Auth. Either have the app accept a **bearer token**
and use Custom header, or, since the panel runs on your PC, click the login form
with your PC mouse/keyboard once: the persistent session keeps you signed in.

## Editor

Open it from the panel's **Edit Grids** tile (it appears on your PC). The left
list holds your **pages** — each is a tile **Grid**, a web **Dashboard**, or a bundled **App**.

![The grid editor — the Default page](docs/shots/editor-default.png)

On a grid page you can:
- **Edit tiles** — label, action (app / URL / shell command / open file / system, or
  **Go to open-quake page** to jump to another of your pages), and icon (emoji, the
  program's own icon, or a custom image).
- **Merge** — click a tile, **Shift-click** another to select a block, then **Merge**
  to show them as one larger button (Unmerge to split).
- **Rearrange** — **drag-and-drop** to swap tiles; drag a merged block to move it
  (tiles it lands on slide into the freed cells).
- **Resize** the grid (columns × rows).

Text fields throughout the editor support the usual **right-click menu** — cut, copy, paste, and select-all.

The shipped **Media** grid is a 10×4 example built around merged buttons — a 4×4
hero plus a couple of 2×2 tiles:

![The Media grid in the editor, with merged buttons](docs/shots/editor-media.png)

Edits apply on **Save** — nothing changes on the panel until then. Which page is
*shown* is controlled by the **knob** (double-click → page selector), not the
editor, so editing never changes what's live.

## Apps

Bundled local web apps live in `apps/`, listed in `apps/apps.json` (each with a
name, file, and an options schema). In the editor, **+ App** adds an app page:
pick the app and set its options — open-quake loads it full-screen on the panel,
no server and no hand-typed URLs.

Included: **Flip Clock** — split-flap animation, 12/24-hour, dark/classic theme,
optional seconds, and a corner date/day. (12-hour shows a single hour card with an
AM/PM badge; 24-hour shows two hour cards.) It ships **enabled by default** (12-hour).
Also included: the **Music** controller (see [Music controller](#music-controller)).

![Configuring the Flip Clock app in the editor](docs/shots/editor-clock.png)

Write your own: drop an HTML file in `apps/` that reads its settings from the URL
**hash** (e.g. `…/myapp.html#color=red`) — a `?query` doesn't survive a `file://`
load — and add an entry to `apps/apps.json` describing its options.

## Music controller

A built-in **Music** app shows what's playing on your PC — title, artist, and play state —
with big touch **transport controls** (play/pause, next, previous, stop), plus a programmable
**2×2 app-launcher grid** on the right (Spotify, YouTube Music, Apple Music, Tidal by default).
It's added on first run; like any app you can delete it (it stays gone) or add more via **+ App**.

- **Now-playing** is read from the Windows media flyout (System Media Transport Controls), so it's
  **app-agnostic** — and the transport buttons send standard media keys, controlling whatever's playing.
- **The 2×2 grid is a real, editable grid** — open the Music app in the editor and program its tiles
  exactly like the Default/Media/Dev grids; each tile opens a URL in your PC browser or launches an app,
  same as any tile. (This is the "grid embedded in an app" capability — apps can carry their own grid.)
- **No admin, no extra software.**

**Works with** anything that appears in the Windows media flyout — tested with Spotify, YouTube Music,
Music Assistant, Amazon Music, Tidal, Apple Music (web), SoundCloud, Bandcamp, and Plex (web). Browser
players generally "just work" via the browser's media-session integration. A few desktop apps don't
register with the flyout and so won't show now-playing or respond to the buttons (e.g. **VLC**, **Plexamp**).

*(Album art is a planned follow-up — the media-flyout thumbnail needs a small helper to extract.)*

## System monitor (SystemView)

A built-in **System Monitor** page shows your PC's live state on the panel — CPU and GPU
load, memory, per-drive disk usage, network throughput, process count, and (on laptops)
battery. It's added automatically on first run as a page named **System Monitor**, and it's a
normal page you can rename, reorder, include in rotation, or delete (delete it and it stays gone).

Under the hood open-quake runs a tiny metrics server bound to `127.0.0.1` (loopback only —
never exposed on the network) and the page reads from it once a second. **No admin rights and
no extra software required.**

**Honest gaps — anything unavailable shows "—", never a fake `0`:**

- **CPU temperature** shows **"—"**. Windows doesn't expose CPU temperature to a normal app:
  the WMI thermal-zone class needs administrator rights and, on most modern CPUs, returns
  nothing anyway. Reading it reliably needs a kernel-level helper (e.g. LibreHardwareMonitor)
  run as admin — which open-quake deliberately doesn't bundle.
- **GPU load** works on **all GPUs** (Intel / AMD / NVIDIA) — read from the Windows GPU
  performance counters, the same source Task Manager uses, no admin.
- **GPU temperature** shows for **NVIDIA** cards (via `nvidia-smi`, which ships with the
  driver). **AMD and Intel GPUs show "—"** — their temperature is only available through a
  vendor SDK (AMD ADLX, Intel's control library) that we don't bundle, to keep open-quake
  portable and install-free.
- **Battery** appears on laptops; on a desktop (no battery) the widget is hidden.

## Adding a dashboard

Web **Dashboard** pages are added the same way as grids and apps — **+ Dashboard**
in the editor, then set the page's name, URL, and (if the site needs it) auth — see
[Dashboards](#dashboards) above for the auth options. Use **Delete page** to remove one.

![Adding and managing a dashboard page in the editor](docs/shots/editor-dashboard.png)

## Settings & knob lighting

The editor's **⚙ Settings** page (top-right) holds the app- and device-level options,
split into a **Software** tab (on launch, screen rotation) and a **Hardware** tab (knob
ring, microphone):

- **On launch** — open the editor window, start **minimized** to the taskbar, or run
  **tray-only** (panel + system tray, no window). open-quake always sits in the system
  tray with quick toggles (mic, knob ring, re-place panel on the device).
- **Screen rotation** — auto-cycle the panel through chosen pages on a timer. Turn it on,
  set the interval (5–3600 s), and pick which **categories** to include (grids, dashboards,
  apps); then tick **Include in rotation** on each page you want in the loop (a page rotates
  only when both its category and its own box are checked). Start or pause it any time from
  the knob's page selector (double-click) or the tray menu.
- **Knob ring** — the RGB ring around the knob. Pick an **effect** (the 44 QMK
  RGB-matrix modes, or *All Off* to turn it off), a **color**, **brightness**, and
  **effect speed**. Changes apply to the ring **instantly**; **Save to device** writes
  them to the device's own memory so they persist across power-cycles.
- **Microphone** — the on-board mic's LED lights whenever the mic is enabled (it's a
  single hardware switch). Choose whether it's on at launch, and toggle it any time from
  the tray menu or a **System → mic** tile.

The ring is driven over the device's QMK VIA lighting channel; settings are stored in
`%APPDATA%\open-quake` and re-applied on connect.

## Layout

```
src/Aris68Connector.js   the HID driver (events out, commands in)   [PolyForm NC]
docs/DEVICE_PROTOCOL.md   reverse-engineered protocol spec           [PolyForm NC]
tools/                    standalone HID probe / write-test scripts  [PolyForm NC]
app/                      the Electron launcher + PC grid editor     [MIT]
  main.js                 host: windows, IPC, launch/volume/config
  index.html              the on-panel UI (grids + web dashboards)
  config.html             the PC editor (pages, tiles, icons)
  config.default.json     seed config (copied to config.json on first run)
  sysmetrics.js           SystemView: live host metrics (systeminformation + GPU counters)
  nowplaying.js           Music: now-playing from Windows SMTC (via PowerShell)
  sysserver.js            localhost server for the SystemView + Music app pages
  sysview.html            SystemView: the on-panel system-monitor dashboard
  musicview.html          Music: now-playing + transport + the embedded app grid
apps/                     bundled local web apps + apps.json manifest [MIT]
```

## Build & run (Windows)

The native modules (`node-hid`, `robotjs`) must be built for this app's Electron
ABI (**Electron 23**), *not* your host Node. A plain `npm install` fails —
`robotjs` (0.6.0) can't compile against modern Node. So install without scripts,
fetch the Electron binary, then rebuild the natives against Electron 23:

```powershell
npm install --ignore-scripts            # packages on disk, no native build
node node_modules/electron/install.js   # fetch the Electron 23 binary
npm run rebuild                          # electron-rebuild -v 23.0.0 -f  (node-hid + robotjs)
npm start
```

Building the natives on modern Windows needs Visual Studio 2022 Build Tools
(Desktop C++ workload) and a Python with `distutils` (`pip install
"setuptools<81"` on Python 3.12+). Set `GYP_MSVS_VERSION=2022` if node-gyp picks
the wrong toolset.

Plug in the DK-QUAKE before `npm start`. The launcher finds the panel display,
places a borderless window on it, wakes the backlight, and starts listening for
touch and knob input.

Set the DK-QUAKE's **display orientation to Landscape** in Windows (Settings →
System → Display) so Windows treats it as a 1920×480 landscape display — that
keeps the mouse and touch aligned with what you see. open-quake auto-rotates its
render if you leave it portrait, but then a desktop mouse moved onto the panel
reads 90° off.

## Licensing

Split-licensed — see **[NOTICE](NOTICE)**:

- **MIT** ([LICENSE](LICENSE)) — the launcher and editor (`app/`), original work.
- **PolyForm Noncommercial 1.0.0** ([src/LICENSE](src/LICENSE)) — every file that
  embeds the reverse-engineered protocol: the driver (`src/Aris68Connector.js`),
  the protocol notes (`docs/DEVICE_PROTOCOL.md`), and the two `tools/` scripts.
  The vendor described the comm protocol as restricted for commercial use; these
  files are **non-commercial only** unless you obtain written commercial
  permission from the protocol holders.

No vendor code, binaries, or API keys are included in this repository.

## Safety

`Aris68Connector.js` knows the firmware-download (DFU) command but never sends
it. **Do not call `enterDfu()`** — it puts the device into firmware-flash mode
and can brick it. The write-test in `tools/` only issues read-only query frames.
