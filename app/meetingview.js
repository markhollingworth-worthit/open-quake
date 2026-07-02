function $(id) { return document.getElementById(id); }

// theme + options — host passes _dark=1/0, _accent=#hex, and app options (defaultPlatform=zoom|teams)
// via the served query, same as every other app page.
var QUERY_DEFAULT_PLATFORM = 'zoom';
(function () {
  try {
    var q = new URLSearchParams(location.search);
    document.body.classList.toggle('light', q.get('_dark') === '0');
    var a = q.get('_accent') || '';
    if (/^#[0-9a-fA-F]{6}$/.test(a)) document.documentElement.style.setProperty('--accent', a);
    var dp = q.get('defaultPlatform');
    if (dp === 'zoom' || dp === 'teams') QUERY_DEFAULT_PLATFORM = dp;
  } catch (e) {}
})();

var ICON = {
  mic:    '<svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z"/><path d="M17 11a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11z"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 6h11a2 2 0 0 1 2 2v1.5l4-2.5v10l-4-2.5V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/></svg>',
  phone:  '<svg viewBox="0 0 24 24"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1z"/></svg>',
  exit:   '<svg viewBox="0 0 24 24"><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5V3z"/><path d="M17.7 12l-3.6-3.6L15.5 7l6 5-6 5-1.4-1.4 3.6-3.6H8v-2z"/></svg>',
  plus:   '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  minus:  '<svg viewBox="0 0 24 24"><path d="M5 11h14v2H5z"/></svg>',
};

// icon: which glyph. cls: 'accept'/'danger' color treatment. rot: true rotates the handset 135°,
// the universal "end call" convention (vs. upright = "answer"). Both platforms render exactly 5
// slots so the card grid doesn't reflow when switching tabs -- Teams' two accept variants occupy
// one slot as a "stack" (two genuinely separate half-height cards, same pattern as the volume
// up/down pair), not a 6th card and not one shared card with an internal divider.
var ACTIONS = {
  zoom: [
    { action: 'mute',    icon: 'mic',    label: 'Mute' },
    { action: 'video',   icon: 'camera', label: 'Video' },
    { action: 'accept',  icon: 'phone',  label: 'Accept',  cls: 'accept' },
    { action: 'decline', icon: 'phone',  label: 'Decline', cls: 'danger', rot: true },
    { action: 'leave',   icon: 'exit',   label: 'Leave',   cls: 'danger' },
  ],
  teams: [
    { action: 'mute',  icon: 'mic',    label: 'Mute' },
    { action: 'video', icon: 'camera', label: 'Video' },
    { stack: true, items: [
        { action: 'acceptAudio', icon: 'phone',  label: 'Accept audio', cls: 'accept' },
        { action: 'acceptVideo', icon: 'camera', label: 'Accept video', cls: 'accept' },
      ] },
    { action: 'decline', icon: 'phone', label: 'Decline', cls: 'danger', rot: true },
    { action: 'hangup',  icon: 'phone', label: 'Hang Up',  cls: 'danger', rot: true },
  ],
};
var PLATFORM_LABEL = { zoom: 'Zoom', teams: 'Teams' };

// The configured "Default platform" option (editor -> Options) decides what shows up on every
// load -- deliberately not remembered-last-tap via localStorage, so there's exactly one source
// of truth for "what do I see when I open this page" and it matches what's configured.
var platform = ACTIONS[QUERY_DEFAULT_PLATFORM] ? QUERY_DEFAULT_PLATFORM : 'zoom';

// Status strip shows only real outcomes -- the last action actually sent and whether it
// succeeded -- never fabricated call/mic/camera state (there's no live feed to read that from;
// see PROJECT.md). Reverts to a neutral "<platform> ready" line a few seconds after each press.
var statusT = null;
function statusReady() { var el = $('status'); el.textContent = PLATFORM_LABEL[platform] + ' ready'; el.classList.remove('err'); }
function statusShow(msg, isError) {
  var el = $('status');
  el.textContent = msg;
  el.classList.toggle('err', !!isError);
  clearTimeout(statusT);
  statusT = setTimeout(statusReady, 3000);
}

function fireAction(plat, action, label) {
  fetch('/meeting-action/' + encodeURIComponent(plat) + '/' + encodeURIComponent(action), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (r) {
      if (r && r.ok) statusShow('Sent: ' + label);
      else statusShow((r && r.error) || 'Failed to send ' + label, true);
    })
    .catch(function () { statusShow('Request failed', true); });
}

function renderPlatforms() {
  document.querySelectorAll('.seg').forEach(function (b) {
    b.classList.toggle('active', b.dataset.platform === platform);
  });
}
function buildCard(a) {
  var b = document.createElement('div');
  b.className = 'abtn' + (a.cls ? ' ' + a.cls : '');
  var icCls = 'ic' + (a.rot ? ' rot135' : '');
  b.innerHTML = '<div class="' + icCls + '">' + ICON[a.icon] + '</div><div class="cap">' + a.label + '</div>';
  b.onclick = function () { fireAction(platform, a.action, a.label); };
  return b;
}
function renderActions() {
  var host = $('actions');
  host.innerHTML = '';
  (ACTIONS[platform] || []).forEach(function (a) {
    if (a.stack) {
      var wrap = document.createElement('div');
      wrap.className = 'stackwrap';
      a.items.forEach(function (it) { wrap.appendChild(buildCard(it)); });
      host.appendChild(wrap);
    } else {
      host.appendChild(buildCard(a));
    }
  });
}
document.querySelectorAll('.seg').forEach(function (b) {
  b.onclick = function () {
    platform = b.dataset.platform;
    renderPlatforms(); renderActions(); statusReady();
  };
});
// Volume buttons are literal .abtn cards (same markup shape as the platform actions) so they're
// guaranteed the same size/styling as their neighbors, not a smaller lookalike ruleset to drift.
$('volUp').innerHTML = '<div class="ic">' + ICON.plus + '</div><div class="cap">Volume +</div>';
$('volDown').innerHTML = '<div class="ic">' + ICON.minus + '</div><div class="cap">Volume −</div>';
$('volUp').onclick = function () { fireAction('system', 'volup', 'Volume up'); };
$('volDown').onclick = function () { fireAction('system', 'voldown', 'Volume down'); };

renderPlatforms();
renderActions();
statusReady();
