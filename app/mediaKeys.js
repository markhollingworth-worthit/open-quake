'use strict';
// Media key adapter — Windows implementation via @jitsi/robotjs.
// Keeps the { transport(cmd), volume(v), pasteShortcut() } interface so main.js
// doesn't know the backend. Swap this file to add platform backends later.

function createMediaKeys({ log = () => {} } = {}) {
  let robot = null;
  try { robot = require('@jitsi/robotjs'); }
  catch (e) {
    try { robot = require('robotjs'); }
    catch (e2) { log('robotjs unavailable (media keys off): ' + e2.message); }
  }

  return {
    transport(cmd) {
      if (!robot) return false;
      const map = { playpause: 'audio_play', next: 'audio_next', prev: 'audio_prev', stop: 'audio_stop' };
      const k = map[cmd];
      if (!k) return false;
      try { robot.keyTap(k); return true; } catch (e) { return false; }
    },
    volume(v) {
      if (!robot) return;
      try {
        if (v === 'mute') robot.keyTap('audio_mute');
        else robot.keyTap(v > 0 ? 'audio_vol_up' : 'audio_vol_down');
      } catch (e) {}
    },
    // Used by the paste-text tile: sends Ctrl+V to the active foreground window.
    pasteShortcut() {
      if (!robot) return false;
      try { robot.keyTap('v', 'control'); return true; } catch (e) { return false; }
    },
    // ---- monitor mode: the device (knob/touch) drives the OS cursor while the panel shows the desktop.
    // Driven only by trusted device input in the main process — never by web/renderer content.
    available() { return !!robot; },
    moveMouse(x, y) { if (robot) { try { robot.moveMouse(x, y); } catch (e) {} } },
    mouseToggle(down, button) { if (robot) { try { robot.mouseToggle(down ? 'down' : 'up', button || 'left'); } catch (e) {} } },
    click(button) { if (robot) { try { robot.mouseClick(button || 'left'); } catch (e) {} } },
    scroll(dy) { if (robot) { try { robot.scrollMouse(0, dy); } catch (e) {} } },
    tapKey(name) { if (robot) { try { robot.keyTap(name); } catch (e) {} } },
  };
}

module.exports = { createMediaKeys };
