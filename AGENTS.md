# Repository Rules

## Drop-in apps

When the user asks to add, create, scaffold, or modify a drop-in app, treat the
drop-in app contract as the boundary.

- Use the project skill at `.codex/skills/open-quake-drop-in-app/SKILL.md` for
  standalone app scaffolding, app manifests, served apps, app options, and use
  of existing generic app capabilities.
- Create or edit files only under `apps/<app-id>/` for the app itself.
- A drop-in app folder should be self-contained:
  - `app.json`
  - `index.html`
  - optional `style.css`
  - optional `app.js`
  - optional `server.js` only when the app declares `"server": "server.js"`
    and the user has approved use of the generic app server capability
  - optional local assets
- Do not edit host/runtime files, `package.json`, or build files for a normal
  drop-in app.
- Do not change app discovery, serving, editor behavior, IPC, packaging, or
  local server behavior for a normal drop-in app.
- If a requested app seems to require platform changes, first explain what the
  current drop-in contract cannot do and ask before doing platform work.
- Keep `app.json` `id` stable, lowercase, and unique. Prefer matching the folder
  name, for example `apps/weather-panel/app.json` uses `"id": "weather-panel"`.
- Prefer new app folders named after the app id. If preserving an existing id
  during migration, keep the old `id` stable even if the folder name differs.
- Use relative links in app HTML, such as `style.css` and `app.js`, so the app
  works under `/apps/<id>/<entry>`.

## Existing Generic App Capabilities

Drop-in apps may use existing generic platform capabilities by declaring them in
`app.json`. This is still app work as long as the host/runtime implementation is
already present and does not need to be changed.

- The current generic proxy contract is:
  - `GET /app-proxy/config` returns the active proxy-enabled app's options.
  - `GET /app-proxy?url=<encoded-url>` fetches an allowed upstream URL for the
    active app.
  - Apps opt in with an `app.json` `proxy` block, for example
    `"proxy": { "methods": ["GET"], "verifySslOption": "verifySsl",
    "allow": [{ "option": "host" }] }`.
  - Apps with reusable server-side logic may declare `"server": "server.js"`;
    the active app can call `GET /app-api/<action>`, and the host invokes that
    module's `handle(action, context)` function.
- Proxy capabilities should be explicit, narrow, and safe by default:
  - app-declared origins or URL patterns
  - GET/POST methods only unless a broader method set is justified
  - no arbitrary localhost/file access unless explicitly allowed
  - no credential logging
  - clear handling for self-signed TLS when the user opts out of verification

## Platform Changes

Only edit host/runtime files when the user explicitly asks to change the
open-quake platform itself, not merely to create or modify an app.

- Platform files include `app/main.js`, `app/sysserver.js`, `app/config.html`,
  `package.json`, build files, app discovery, serving, editor behavior, IPC,
  packaging, and local server behavior.
- Prefer generic, capability-based platform changes over app-specific hooks.
- Do not add host routes named for a single app, such as `/api/qnap/...`, unless
  the user specifically asks for a one-off built-in integration.
- Keep app-specific code under `apps/<app-id>/`; keep host code generic enough
  to be reused by other drop-in apps.
