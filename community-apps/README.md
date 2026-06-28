# Community drop-in apps — downloads

Downloadable drop-in apps for open-quake. Grab an app's **`.zip`** below and import it with
**Settings → Drop-In Apps → Add (import .zip)**.

For how to install or submit an app — and a safety note — see the docs:
**[docs/community-apps.md](../docs/community-apps.md)**.

## Available apps

- **[news-spotlight](news-spotlight)** — full-screen rotating RSS feed reader. Defaults
  to BBC / Sky / The Verge / Ars Technica; configurable feeds, story duration, Ken
  Burns motion, breaking-news mode, and an SSRF-safe proxy. Download
  [`news-spotlight.zip`](news-spotlight.zip) and import via
  **Settings → Drop-In Apps → Add**.

To add one, open a pull request — see
[docs/community-apps.md](../docs/community-apps.md#submitting-one).

## For developers

Building your own drop-in app? The [`skills/`](skills) folder holds
Claude Code skills you can drop into your `.claude/skills/` to get
AI-assisted scaffolding and authoring help. Today:

- [`open-quake-drop-in-app`](skills/open-quake-drop-in-app) — guides
  Claude through the manifest schema, served vs. file modes, options,
  `/app-proxy`, `/app-api`, and the host/runtime boundary so it stays
  inside `apps/<app-id>/` and doesn't touch platform code.
