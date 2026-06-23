'use strict';
// Media key adapter — Windows implementation via robotjs.
// Keeps the same { transport(cmd), volume(v) } interface as the hardened fork's adapter
// so main.js doesn't need to know the backend. Swap this file to add platform backends later.

function createMediaKeys({ log = () => {} } = {}) {
  let robot = null;
  try { robot = require('robotjs'); } catch (e) { log('robotjs unavailable (media keys off): ' + e.message); }

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
  };
}

module.exports = { createMediaKeys };
