# open-quake

An open driver and touchscreen launcher for the **DK-QUAKE / ARIS-68** — the
1920×480 touchscreen-plus-knob macro device (sold with the closed-source
DK-Suite app). `open-quake` talks to it directly over HID, with no vendor
software running.

It gives you:

- **A multi-grid launcher** — each page is a grid of tiles; tap a tile to open an
  app, URL, shell command, file, or system action (lock screen). A tile's icon
  can be an emoji, the program's own icon, or a custom image.
- **Web dashboard pages** — a page can instead be a live web view (Home Assistant,
  Grafana / server monitoring, a status page, …) shown full-screen on the panel:
  the knob scrolls it, a tap clicks, and logins persist across restarts. Pages that
  need auth can inject a Home Assistant long-lived token, HTTP Basic Auth, or custom
  header(s) (bearer / Cloudflare Access) — set per page in the editor.
- **Knob control** — rotate for volume (or to scroll the current dashboard),
  single-click to mute, **double-click to open the page selector** (rotate to
  pick a page by name, press to switch).
- **A PC-side editor** — create grids and dashboards, lay out tiles and their
  icons (emoji / app icon / image), then **Save** to push to the panel.

> **Status:** early. Touch, knob, grids, web dashboards, and the editor are
> working and validated against real hardware. The panel is driven as a normal external
> monitor (Windows sees a 480×1920 / 1920×480 display); pushing frames over the
> HID resource channel is not implemented.

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
```

## Build & run (Windows)

The native modules (`node-hid`, `robotjs`) must be compiled for the Electron ABI
this app uses (**Electron 23**). On a clean machine:

```powershell
npm install
npm run rebuild      # electron-rebuild -v 23.0.0 -f  (rebuilds node-hid + robotjs for Electron 23)
npm start
```

Building the native modules on modern Windows needs Visual Studio 2022 Build
Tools (Desktop C++ workload) and a Python with `distutils` (`pip install
"setuptools<81"` if you're on Python 3.12+). Set `GYP_MSVS_VERSION=2022` if
node-gyp picks the wrong toolset.

Plug in the DK-QUAKE before `npm start`. The launcher finds the panel display,
places a borderless window on it, wakes the backlight, and starts listening for
touch and knob input.

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
