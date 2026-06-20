# Settings & knob lighting

The editor's **⚙ Settings** page (top-right) holds the app- and device-level options,
split into a **Software** tab (on launch, screen rotation) and a **Hardware** tab (knob
ring, microphone):

- **On launch** — open the editor window, start **minimized** to the taskbar, or run
  **tray-only** (panel + system tray, no window). open-quake always sits in the system
  tray with quick toggles (mic, knob ring, re-place panel on the device).
- **Knob controls** — choose what turning the knob does on the panel: adjust PC
  volume, or open the page selector and move through pages. Press the knob to
  select; leaving the selector idle closes it without changing pages.
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
