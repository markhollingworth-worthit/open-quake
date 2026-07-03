# PROJECT — Desktop focus (panel auto-follows the foreground PC app)

When a configured desktop application becomes the foreground/focused window on the
PC, the panel automatically switches to the page mapped to that app — no manual
navigation needed. Focus Spotify → panel jumps to Music. Focus Teams → panel jumps
to Meeting. Focus something unmapped → panel stays where it is.

## Charter

**1. What is the one thing this must do?**
Track which application has OS-level foreground focus on the PC, and when it
changes to an app the user has mapped to a panel page, switch the panel to that
page automatically.

**2. What would be wrong if we shipped "working" software without it?**
- **Must not fight manual navigation.** If the user deliberately navigates the
  panel away (knob turn, page-menu double-tap) while the mapped app is *still*
  focused, the feature must not immediately snap back — that would make the panel
  feel broken/uncontrollable. It should only re-trigger on the next genuine focus
  *change* to a mapped app, not re-assert an already-satisfied match.
- **Must not fight itself on rapid alt-tabbing.** Switching panel pages on every
  transient focus flicker (e.g. holding Alt+Tab through several windows) would be
  visually chaotic. Needs debounce.
- **Must be fully optional per-page and globally.** A page with no mapped app(s)
  is never auto-selected; the whole feature must have a global off switch.

**3. What is explicitly off-limits as a workaround?**
- No requiring cooperation/plugins from the target desktop apps (no "Spotify must
  install X") — this is OS-level foreground-window tracking only, same spirit as
  the existing SMTC now-playing read and the Teams force-focus mechanism already
  in this codebase.
- No polling so aggressively it becomes a noticeable CPU/battery cost — match the
  cadence of existing pollers in this app (SMTC now-playing polls every 2.5s;
  auto-rotation's own interval is user-configurable).

**4. Deployment target and backup location?**
- Target: bundled into **open-quake** (Windows desktop, Electron).
- Backup: the git repo, `desktop-focus` branch — commits are the backup.

**5. How will we verify it's done?**
- Map Spotify → Music page, Teams → Meeting page. Focus Spotify on the PC (any
  window of it) → panel switches to Music within the poll interval. Focus Teams →
  panel switches to Meeting. Focus an unmapped app (e.g. a text editor) → panel
  stays on whatever page it was last on.
- While Spotify is focused and Music is showing, manually navigate the panel to a
  different page — it stays there (doesn't snap back) until focus changes to
  something else and back to Spotify again.
- Global toggle off → no auto-switching occurs regardless of focus changes.
- Rapid alt-tabbing between two mapped apps doesn't cause visible page-switch
  flicker faster than the debounce window.

## Decisions (signed off 2026-07-02)

1. **Detection mechanism**: polling, ~1.5s interval (matches `nowplaying.js`'s cadence).
2. **Matching key**: process executable name (e.g. `spotify.exe`). Plus a
   "browse running apps" picker (`Get-Process | Where-Object MainWindowTitle`,
   same technique `meetingControl.js`'s Teams-focus script already uses to find
   processes with a real window) so the user doesn't have to know/type exact exe
   names — free-text entry stays available too, for mapping an app that isn't
   currently running.
3. **Mapping location**: new "Focus trigger app(s)" field in each page's existing
   Advanced settings section.
4. **Global toggle**: sibling to the existing auto-rotation on/off switch in Settings.

## Approach

- **`app/desktopFocus.js`** (new) — `getForegroundProcessName()` (adapt the
  P/Invoke `GetForegroundWindow`/`GetWindowThreadProcessId` pattern already
  proven in `meetingControl.js`, reading instead of setting), `listRunningApps()`
  (the picker query), and a poll loop that emits only on process-name *change*
  (not every tick) — this is what naturally satisfies "don't fight manual
  navigation while the same app stays focused."
- **Debounce**: require the same new foreground process to be stable across 2
  consecutive polls (~3s) before triggering, so rapid alt-tabbing doesn't cause
  page-switch flicker.
- **Data model**: `g.focusApps` (array of process name strings) per page.
  `config.settings.focusFollow = { enabled: bool }` alongside the existing
  rotation settings shape.
- **Editor**: `focusApps` list editor in `advRowHtml`/`wireAdvRow` (add/remove
  chips, each addable by free-text or via the running-apps picker) + the global
  toggle placed next to Settings' existing rotation controls.
- **Main process**: on a genuine foreground-change event (from the poll loop),
  if `focusFollow.enabled` and some page's `focusApps` includes the new process
  name, `gotoGrid()` to it. No action on unmapped processes or steady-state
  (same app still focused) polls.
