# Apps

Bundled apps are listed in `apps/apps.json`. Additional **drop-in apps** are
self-contained folders (a manifest plus their files) that live in your user-data
folder — **`%APPDATA%\open-quake\apps`** by default (see *Storage location* below) — so
they survive app updates. The easiest way to add one is **Settings → Drop-In Apps → Add**.
In the editor, **+ App** adds an app page: pick the app and set its options, and
open-quake loads it full-screen on the panel with no hand-typed URLs.

Included apps:
- **Flip Clock** — split-flap animation, 12/24-hour, optional seconds, and a corner
  date/day. (12-hour shows a single hour card with an AM/PM badge; 24-hour shows two hour
  cards.) Follows the global light/dark theme and accent. Ships **enabled by default** (12-hour).
- **World Clock** — the time in several places at once. Two modes: **US time zones**
  (Pacific / Mountain / Central / Eastern) or a pick of **2–6 world cities**; each shown as a
  **digital** readout or an **analog** face. Options include 12/24-hour, optional seconds (with
  a second hand on the analog faces), and a **per-city label override** (e.g. pick *London* but
  label it *Edinburgh*). DST-correct via the system's time-zone database; follows the global
  light/dark theme and accent.
- **[Music controller](music.md)** — now-playing + transport + a programmable app grid.
- **[Open WebUI chat + voice](ai-chat.md)** — talk to your own LLM, with knob push-to-talk.
- **[Home Assistant Dashboard](home-assistant.md)** — pick a Lovelace dashboard from your
  HA server in a dropdown, no hand-typed URLs. Requires **Use Home Assistant** in
  **Settings → Auth**; hidden from the App picker otherwise. Uses your global HA token
  so login persists. (See the full HA guide for entity tiles + icons.)

![Configuring the Flip Clock app in the editor](shots/editor-clock.png)

## Drop-in folder apps

A drop-in app is a self-contained folder. Install it the easy way with
**Settings → Drop-In Apps → Add (import .zip)**, or place the folder by hand in your
drop-in apps folder (**`%APPDATA%\open-quake\apps`** by default — see *Storage location*
below):

```text
%APPDATA%\open-quake\apps\
  my-app\
    app.json
    index.html
    style.css
    app.js
```

open-quake only discovers drop-in apps from that user-data folder — **not** from the
bundled install directory — so an update never wipes them out.

The manifest can be named `app.json` or `manifest.json`:

```json
{
  "id": "my-app",
  "name": "My App",
  "entry": "index.html",
  "served": false,
  "options": []
}
```

Rules:

- `id` must start with a lowercase letter or digit and then use only lowercase
  letters, digits, `_`, or `-`.
- `entry` must be a relative file path inside the app folder and must not
  contain `..`.
- Duplicate ids are skipped; bundled `apps/apps.json` entries win.
- `options` uses the same schema as bundled apps. The editor stores each option
  on the app page and passes non-secret values to the app at launch.

After adding or editing a folder app, click **Refresh** beside the App dropdown
in the editor to reload manifests.

## Managing drop-in apps (Settings → Drop-In Apps)

The editor's **Settings → Drop-In Apps** tab manages app folders for you:

- **Add (import .zip)** — pick a `.zip`; it's unzipped into your drop-in folder. If its `id`
  already exists you're prompted to rename it, and if the app bundles **executable code** (a
  `server` module or programs/scripts) you're warned to confirm you trust the source first.
- **Export** — zip an installed drop-in app to share it.
- **Delete** — remove an app's folder.
- **Refresh** — re-scan for changes (import and delete refresh automatically).
- **Community apps ↗** — opens the
  [community-apps](https://github.com/TeeJS/open-quake/tree/main/community-apps) download
  folder, where you can grab an app's `.zip` and import it. See
  [Community apps](community-apps.md) for installing and submitting.

**Storage location** (Advanced) — drop-in apps live in **`%APPDATA%\open-quake\apps`** by default
(switchable to `%LOCALAPPDATA%\open-quake\apps`). This is the **only** place open-quake looks for
drop-in apps, and it **survives app updates** — unlike the install folder, which an update
overwrites. Switching the location moves where new imports land; move any existing app folders
across yourself if you change it.

## Static and served modes

- **Static (`"served": false`)** — open-quake loads `entry` directly via
  `file://` from the app folder. Options are passed in the URL hash:
  `index.html#color=red`. Static apps are best for self-contained HTML/CSS/JS.
- **Served (`"served": true`)** — open-quake serves the app folder on the local
  loopback server at `http://127.0.0.1:<port>/apps/<id>/<entry>`. Options are
  passed as normal query parameters: `index.html?color=red`. Use this for apps
  that need same-origin `fetch`, browser APIs that require HTTP, or multiple
  static assets served through the same origin.

Served drop-in apps can also declare host-side helpers:

```json
{
  "server": "server.js",
  "proxy": {
    "methods": ["GET"],
    "verifySslOption": "verifySsl",
    "allow": [{ "option": "host" }]
  }
}
```

- `server` loads a local Node module from the app folder. It should export
  `handle(action, context)`. The page calls it with `/app-api/<action>`.
- `context.options` contains the active app options, including options marked
  `"serverOnly": true` and secret options.
- `"serverOnly": true` keeps an option out of the page URL while still making it
  available to the server adapter and `/app-proxy/config`.
- `/app-proxy?url=...` is available only to the requesting app page and only for
  URLs allowed by the app manifest. `{ "option": "host" }` allows requests to the
  configured host origin, including LAN devices.

See `docs/app-template/` for a minimal starting point.

## Legacy bundled apps

Two kinds of bundled app:

- **Static (`file://`)** — drop an HTML file in `apps/` that reads its settings from the URL
  **hash** (e.g. `…/myapp.html#color=red`) — a `?query` doesn't survive a `file://`
  load — and add an entry to `apps/apps.json` describing its options. The Flip Clock is one.
- **Served (`"served": true`)** — for apps that need live host data, a same-origin `fetch`,
  or an embedded launcher grid. open-quake serves these over a loopback HTTP server at
  `http://127.0.0.1:<port>/<id>`, so they get real `?query` params and a secure context
  (needed for things like the microphone). The Music controller and Open WebUI app use this.
  A served app can also carry its own **editable tile grid** (`"grid"` in its manifest entry) —
  the "grid embedded in an app" capability.
