# Community drop-in apps

Drop-in apps shared by the open-quake community. Each subfolder here is a self-contained
**drop-in app** (an `app.json` manifest + its files) you can install via
**Settings → Drop-In Apps → Add**.

## Installing one

1. Download an app's folder as a `.zip` (e.g. GitHub **Code → Download ZIP** for the repo, then
   keep just that app's folder, or grab a `.zip` the author attaches to a release).
2. In open-quake: **Settings → Drop-In Apps → Add (import .zip)…** and pick the zip. If the id
   already exists you'll be prompted to rename it.

## Submitting one

Open a pull request adding a folder `community-apps/<your-app-id>/` containing at least an
`app.json` (see [`docs/app-template/`](../docs/app-template/)) plus the app's files.

- `id` must be unique and lowercase — letters, digits, `_`, `-`.
- Say what the app does (and whether it needs a `server` module or `proxy`) in the PR.

## ⚠️ Safety

These are **community-submitted and not vetted by the maintainers**. A drop-in app can ship a
**server module** or bundled programs that run on your PC with full access — open-quake warns you
on import when it does. **Only install apps from sources you trust, and review the code first.**
