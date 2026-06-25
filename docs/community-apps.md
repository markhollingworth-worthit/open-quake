# Community drop-in apps

How to **install** a community drop-in app, and how to **submit** your own. The apps
themselves live in a separate download area — the
[`community-apps/`](../community-apps) folder — and the editor links straight to it
(**Settings → Drop-In Apps → Community apps ↗**). This page is the documentation; that
folder is the download.

## Installing one

1. Open the [`community-apps/`](../community-apps) folder and pick an app.
2. Download its `.zip` (open the `.zip`, then **Download**).
3. In open-quake: **Settings → Drop-In Apps → Add (import .zip)** and choose the file.
   If its id already exists you'll be prompted to rename it, and if it bundles
   executable code you'll be asked to confirm you trust the source.

Installed apps land in your user-data folder (`%APPDATA%\open-quake\apps` by default), so
they survive app updates. See [Apps & drop-ins](apps.md) for the full manager.

## Submitting one

Open a pull request that adds **both**:

- `community-apps/<your-app-id>/` — your app's source folder (an `app.json` manifest plus
  its files), so others can review the code; and
- `community-apps/<your-app-id>.zip` — the same folder zipped, ready to import.

Rules:

- `id` must be unique and lowercase — letters, digits, `_`, `-`.
- Say what the app does, and whether it needs a `server` module or `proxy`, in the PR.
- See [`docs/app-template/`](app-template) for a minimal starting point and
  [Apps & drop-ins](apps.md) for the manifest schema.

## ⚠️ Safety

Community apps are **submitted by others and not vetted by the maintainers**. A drop-in app
can ship a **server module** or bundled programs that run on your PC with full access —
open-quake warns you on import when it does. **Only install apps from sources you trust, and
review the source folder before importing.**
