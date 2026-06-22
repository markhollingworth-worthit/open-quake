# Bundled apps

Bundled local web apps live in `apps/`. Older bundled apps can still be listed in
`apps/apps.json`; newer apps can also be dropped in as folders with their own
`app.json` manifest. In the editor, **+ App** adds an app page: pick the app and
set its options — open-quake loads it full-screen on the panel, no server and no
hand-typed URLs.

Included apps:
- **Flip Clock** — split-flap animation, 12/24-hour, dark/classic theme,
  optional seconds, and a corner date/day. (12-hour shows a single hour card with an
  AM/PM badge; 24-hour shows two hour cards.) It ships **enabled by default** (12-hour).
- **[Music controller](music.md)** — now-playing + transport + a programmable app grid.
- **[Open WebUI chat + voice](ai-chat.md)** — talk to your own LLM, with knob push-to-talk.

![Configuring the Flip Clock app in the editor](shots/editor-clock.png)

## Write your own

The easiest shape is a self-contained folder:

```text
apps/
  my-app/
    app.json
    index.html
    style.css
    app.js
```

`app.json` describes the app:

```json
{
  "id": "my-app",
  "name": "My App",
  "entry": "index.html",
  "served": false,
  "options": [
    { "key": "theme", "label": "Theme", "type": "select", "default": "dark", "choices": [["dark", "Dark"], ["light", "Light"]] }
  ]
}
```

Restart open-quake after adding or changing app folders; the editor discovers
manifests at launch. See `docs/app-template/` for a minimal starting point.

Two kinds of bundled app:

- **Static (`file://`)** — drop an HTML file in `apps/` that reads its settings from the URL
  **hash** (e.g. `…/myapp.html#color=red`) — a `?query` doesn't survive a `file://`
  load. Folder apps can reference their own CSS and JS with ordinary relative paths.
  The Flip Clock is one.
- **Served (`"served": true`)** — for apps that need live host data, a same-origin `fetch`,
  or an embedded launcher grid. open-quake serves these over a loopback HTTP server at
  `http://127.0.0.1:<port>/apps/<id>/...`, so they get real `?query` params and a secure context
  (needed for things like the microphone). The Music controller and Open WebUI app use this.
  A served app can also carry its own **editable tile grid** (`"grid"` in its manifest entry) —
  the "grid embedded in an app" capability.
