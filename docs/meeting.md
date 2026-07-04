# Meeting

One-tap call control for **Zoom** and **Teams** from the panel — mute, video, accept,
decline, leave — without touching the keyboard or mouse. It doesn't launch or manage a
call; it sends the same global keystroke Zoom/Teams themselves already bind, so it only
does anything useful while a call is actually active in that app.

Add a page → **+ App** → pick **Meeting**.

## Options

- **Default platform** — which tab (Zoom or Teams) the page opens to. You can still
  switch tabs on the panel for a one-off call on the other platform; this only sets
  what shows by default.
- **Use Zoom's default keymappings** — on by default. Zoom ships these combos already
  bound (Alt+A mute, Alt+V video, Ctrl+Shift+A/D phone accept/decline, Alt+Q leave); if
  you haven't remapped them yourself in Zoom, leave this on and there's nothing else to
  configure. Turn it off to enter your own combos, matching whatever you've customized
  in Zoom → Settings → Keyboard Shortcuts.

| Action | Zoom default |
|---|---|
| Mute/unmute | `Alt+A` |
| Start/stop video | `Alt+V` |
| Accept inbound call | `Ctrl+Shift+A` |
| Decline inbound call | `Ctrl+Shift+D` |
| Leave meeting | `Alt+Q` |

Whichever combo is active — default or custom — must have **"Enable Global Shortcut"**
ticked for that action in Zoom's own Keyboard Shortcuts settings, or Zoom won't respond
to it unless its window already has focus.

## Teams

Teams' combos are fixed and not configurable — they're Microsoft Teams' own built-in
global shortcuts (`Ctrl+Shift+M` mute, `+A` accept with video, `+S` accept audio-only,
`+D` decline, `+H` hang up, `+O` toggle video). Unlike Zoom, Teams needs its window
force-focused immediately before each keystroke to respond reliably — open-quake does
this automatically, so it works even when Teams isn't the visible foreground app.

## Honest limits

open-quake has no way to know whether a call is actually active — a tap just sends the
configured keystroke. If nothing's on the call, nothing visibly happens. There's no
on-panel call timer or participant list; this is a remote control, not a client.
