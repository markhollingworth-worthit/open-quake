# PROJECT — Meeting panel (Zoom + Teams call control)

Let the user trigger real call actions (mute/unmute, volume, and whatever else is
genuinely available) on an active Zoom or Microsoft Teams call from the open-quake
panel/knob, without alt-tabbing to the call window.

## Charter

**1. What is the one thing this must do?**
Real call control from the panel — for Zoom specifically, this must work **even when
Zoom isn't the focused window**, since that's the whole point of building Zoom first
(Zoom has a genuine OS-level global-shortcut feature; Teams no longer does, as of the
local API's retirement on 2026-06-30).

**2. What would be wrong if we shipped "working" software without it?**
- Offering the same uniform button set for both platforms when their real capability
  differs. Teams' remaining mechanism (keyboard shortcuts) only works while Teams is
  the focused/visible window; the UI must not imply parity it doesn't have.
- Silent failure — if a press does nothing (e.g. Teams wasn't focused), that must be a
  documented, known limitation, not a mystery.
- Zoom support that requires Zoom to be focused would defeat the reason we're building
  Zoom first at all.

**3. What is explicitly off-limits as a workaround?**
- No clicking hardcoded screen coordinates to hit an "Answer" toast — breaks on any UI
  change, DPI scaling, or window position.
- No asserting a keybind/feature exists without checking the platform's current,
  official shortcut list first (already done for both — see below).
- No forcibly stealing OS focus without the user explicitly choosing that trade-off
  (open question #2 below).

**4. Deployment target and backup location?**
- Target: bundled into **open-quake** (Windows desktop, Electron).
- Backup: the git repo (`touch-display-setup`'s successor, `meetings` branch) —
  commits are the backup per the git-repo exception.

**5. How will we verify it's done?**
- A live Zoom call: mute/unmute (and whatever else we wire) actually toggles in Zoom
  while some other window is focused.
- A live Teams call: mute/unmute toggles when Teams is focused/visible; documented
  that it may not fire otherwise (per the design decision on option #2 below).
- Editor lets the user add these actions, showing only what's genuinely wired per
  platform — no fake parity between Zoom and Teams button lists.

## What we already know (researched this session)

- **Zoom**: Settings → Keyboard Shortcuts → per-action **"Enable Global Shortcut"**
  checkbox. First-party, documented, works system-wide once the user assigns a combo
  *inside Zoom itself*. Confirmed for mute/unmute; full list of which other actions
  support the global checkbox not yet confirmed.
- **Teams**: local WebSocket API (port 8124) **retired by Microsoft 2026-06-30**.
  Remaining: `Ctrl+Shift+M` (mute), `Ctrl+Shift+A`/`Ctrl+Shift+S` (accept video/audio),
  `Ctrl+Shift+D` (decline), `Ctrl+Shift+H` (end call), `Ctrl+Shift+O` (camera) — all
  require Teams to be the focused window. Windows' OS-level Global Mute (Win+Alt+K) is
  a separate, non-Teams-specific mechanism with a flaky track record as of the most
  recent info found (late 2024).
- Volume is not a Teams/Zoom concept either way — it's OS-level per-app or master
  volume, unrelated to either platform's own API/shortcuts.

## Decisions (signed off 2026-07-01)

1. **Dedicated "Meeting" app page** — `kind:'app'`, `app:'meeting'`, mirroring the
   Music app's pattern, with a platform switcher (Zoom / Teams) inside it. Left to my
   discretion; going with the dedicated page.
2. **Teams focus handling** — force-focus Teams before sending the keystroke, using
   the most reliable mechanism available (not the naive `SetForegroundWindow` call,
   which Windows' foreground-lock protection frequently blocks from a background
   process — use the `AttachThreadInput` workaround instead).
3. **Zoom keybinds** — allow both: ship sensible default combos the user can assign
   inside Zoom's own settings, AND let the user override with whatever combo they've
   already configured, per action.

## Approach

- **`app/meetingControl.js`** — new module. `sendMeetingAction(platform, action, deps)`:
  - Teams: force-focus the Teams process window (PowerShell + P/Invoke
    `AttachThreadInput`/`SetForegroundWindow`, consistent with `touchSetup.js`'s
    existing elevated-PowerShell pattern), then send the fixed Teams shortcut via the
    robotjs instance already used in `mediaKeys.js`.
  - Zoom: send the user-configured (or default) keystroke directly via robotjs — no
    focus-forcing needed, since Zoom's own "Enable Global Shortcut" makes it work
    regardless of focus once the user has set it up inside Zoom.
- **New built-in app page** — `app:'meeting'`, cloning the Music app's
  ensure-page-exists-once / respect-deletion pattern in `main.js`. Page renders a
  platform switcher + action buttons; per-platform action list reflects only what's
  genuinely wired (no fake Zoom/Teams parity).
- **Editor** — `renderAppOpts`-style options: platform-specific keybind fields for
  Zoom (editable, defaults pre-filled), read-only display of the fixed Teams shortcuts
  (not editable, since Teams' shortcuts aren't user-configurable).
- **actionRunner.js** — no change needed; this routes through `meetingControl.js`
  directly from the app page's button handler, not through the generic tile action
  system (this isn't a tile action, it's the Meeting app's own button grid, like
  Music's transport controls).
