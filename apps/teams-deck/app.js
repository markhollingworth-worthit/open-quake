(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var actionIndex = {};
  var activePanel = 'home';
  var graphToken = '';
  var actionAliases = {
    'Teams App': ['Bring Teams To Front'],
    'Camera': ['Toggle Camera'],
    'Team / Channel': ['Teams'],
    'Join Meeting': ['Calendar'],
    'Call': ['Calls'],
    'Send Message': ['Chat']
  };
  var sectionButtons = [
    { label: 'Calendar', icon: '📅', panel: 'calendar', accent: 'blue' },
    { label: 'New Chat', icon: '✎', action: 'New Chat', panel: 'message', accent: 'indigo' },
    { label: 'Team / Channel', icon: '👥', panel: 'team', accent: 'green' },
    { label: 'Join Meeting', icon: 'T', panel: 'meeting', accent: 'lime' },
    { label: 'Call', icon: '📞', panel: 'calls', accent: 'yellow' },
    { label: 'Call Controls', icon: '•••', panel: 'call', accent: 'pink' },
    { label: 'App Navigation', icon: '▦', panel: 'nav', accent: 'rose' },
    { label: 'Status + Info', icon: 'i', panel: 'status', accent: 'amber' },
    { label: 'Send Message', icon: '➤', panel: 'message', accent: 'violet' }
  ];
  function homeButtons() {
    return [
      { label: 'Bring Teams To Front', icon: '▦', action: 'Teams App', size: 'hero' },
      { label: 'Answer Call', icon: '📞', action: 'Accept Call', size: 'hero' },
      { label: 'Mute / Unmute', icon: '🎙', action: 'Mute / Unmute', size: 'hero' },
      { label: 'Camera', icon: '🎥', action: 'Camera' },
      { label: 'Share Screen', icon: '↥', action: 'Share Screen' },
      { label: 'Raise Hand', icon: '✋', action: 'Raise Hand' },
      { label: 'Meeting Chat', icon: '…', action: 'Meeting Chat' },
      { label: 'People', icon: '♟', action: 'People' },
      { label: 'Decline Call', icon: '☎', action: 'Decline Call', tone: 'danger' }
    ].concat(sectionButtons);
  };
  var panels = {
    home: homeButtons(),
    call: [
      { label: 'Back', icon: '←', panel: 'home', accent: 'blue' },
      { label: 'Accept Call', icon: '✅', action: 'Accept Call', size: 'hero' },
      { label: 'Decline Call', icon: '❌', action: 'Decline Call', size: 'hero' },
      { label: 'Mute / Unmute', icon: '🎙️', action: 'Mute / Unmute', size: 'hero' },
      { label: 'Camera', icon: '🎥', action: 'Camera' },
      { label: 'Share Screen', icon: '🖥️', action: 'Share Screen' },
      { label: 'Raise Hand', icon: '✋', action: 'Raise Hand' },
      { label: 'Meeting Chat', icon: '💬', action: 'Meeting Chat' },
      { label: 'People', icon: '👥', action: 'People' },
      { label: 'Blur', icon: '🫥', action: 'Blur' },
      { label: 'Shortcuts', icon: '⌨️', action: 'Shortcuts' },
      { label: 'Teams App', icon: '🪟', action: 'Teams App' }
    ],
    nav: [
      { label: 'Back', icon: '←', panel: 'home', accent: 'blue' },
      { label: 'Teams App', icon: '🪟', action: 'Teams App', size: 'hero' },
      { label: 'Search', icon: '🔎', action: 'Search', size: 'hero' },
      { label: 'Activity', icon: '🔔', action: 'Activity' },
      { label: 'Chat', icon: '💬', action: 'Chat' },
      { label: 'Teams', icon: '#️⃣', action: 'Teams' },
      { label: 'Calendar', icon: '📅', action: 'Calendar' },
      { label: 'Calls', icon: '📞', action: 'Calls' },
      { label: 'Files', icon: '📁', action: 'Files' },
      { label: 'Shortcuts', icon: '⌨️', action: 'Shortcuts' },
      { label: '', empty: true },
      { label: '', empty: true }
    ],
    status: [
      { label: 'Back', icon: '←', panel: 'home', accent: 'blue' },
      { label: 'Refresh Status', icon: '🔄', refresh: true, size: 'hero' },
      { label: 'Teams App', icon: '🪟', action: 'Teams App', size: 'hero' },
      { label: 'Calendar', icon: '📅', action: 'Calendar' },
      { label: 'Calls', icon: '📞', action: 'Calls' },
      { label: 'Chat', icon: '💬', action: 'Chat' },
      { label: 'Search', icon: '🔎', action: 'Search' },
      { label: 'Shortcuts', icon: '⌨️', action: 'Shortcuts' },
      { label: '', empty: true },
      { label: '', empty: true },
      { label: '', empty: true },
      { label: '', empty: true }
    ],
    calendar: [
      { label: 'Back', icon: '←', panel: 'home', accent: 'blue' },
      { label: 'Open Calendar', icon: '📅', action: 'Calendar', size: 'hero' },
      { label: 'Join Meeting', icon: 'T', action: 'Join Meeting', size: 'hero' },
      { label: 'Refresh Status', icon: '🔄', refresh: true, size: 'hero' },
      { label: 'Meeting Chat', icon: '…', action: 'Meeting Chat' },
      { label: 'People', icon: '♟', action: 'People' },
      { label: 'Teams App', icon: '▦', action: 'Teams App' },
      { label: '', empty: true },
      { label: '', empty: true },
      { label: '', empty: true },
      { label: '', empty: true },
      { label: '', empty: true }
    ],
    compose: [
      { label: 'Back', icon: '←', panel: 'home', accent: 'blue' },
      { label: 'New Chat', icon: '✎', action: 'New Chat', panel: 'message', size: 'hero' },
      { label: 'Search', icon: '🔎', action: 'Search', size: 'hero' },
      { label: 'Send Message', icon: '➤', panel: 'message', size: 'hero' },
      { label: 'Chat', icon: '💬', action: 'Chat' },
      { label: 'Teams', icon: '#', action: 'Teams' },
      { label: 'Shortcuts', icon: '⌨', action: 'Shortcuts' },
      { label: '', empty: true },
      { label: '', empty: true },
      { label: '', empty: true },
      { label: '', empty: true },
      { label: '', empty: true }
    ],
    team: [
      { label: 'Back', icon: '←', panel: 'home', accent: 'blue' },
      { label: 'Teams', icon: '#', action: 'Teams', size: 'hero' },
      { label: 'Team / Channel', icon: '👥', action: 'Team / Channel', size: 'hero' },
      { label: 'Search', icon: '🔎', action: 'Search', size: 'hero' },
      { label: 'Chat', icon: '💬', action: 'Chat' },
      { label: 'Files', icon: '📁', action: 'Files' },
      { label: 'Activity', icon: '🔔', action: 'Activity' },
      { label: '', empty: true },
      { label: '', empty: true },
      { label: '', empty: true },
      { label: '', empty: true },
      { label: '', empty: true }
    ],
    meeting: [
      { label: 'Back', icon: '←', panel: 'home', accent: 'blue' },
      { label: 'Join Meeting', icon: 'T', action: 'Join Meeting', size: 'hero' },
      { label: 'Calendar', icon: '📅', action: 'Calendar', size: 'hero' },
      { label: 'Teams App', icon: '▦', action: 'Teams App', size: 'hero' },
      { label: 'Mute / Unmute', icon: '🎙', action: 'Mute / Unmute' },
      { label: 'Camera', icon: '🎥', action: 'Camera' },
      { label: 'People', icon: '♟', action: 'People' },
      { label: 'Meeting Chat', icon: '…', action: 'Meeting Chat' },
      { label: 'Share Screen', icon: '↥', action: 'Share Screen' },
      { label: 'Raise Hand', icon: '✋', action: 'Raise Hand' },
      { label: '', empty: true },
      { label: '', empty: true }
    ],
    calls: [
      { label: 'Back', icon: '←', panel: 'home', accent: 'blue' },
      { label: 'Calls', icon: '📞', action: 'Calls', size: 'hero' },
      { label: 'Accept Call', icon: '✅', action: 'Accept Call', size: 'hero' },
      { label: 'Decline Call', icon: '☎', action: 'Decline Call', size: 'hero', tone: 'danger' },
      { label: 'Mute / Unmute', icon: '🎙', action: 'Mute / Unmute' },
      { label: 'Camera', icon: '🎥', action: 'Camera' },
      { label: 'People', icon: '♟', action: 'People' },
      { label: 'Shortcuts', icon: '⌨', action: 'Shortcuts' },
      { label: '', empty: true },
      { label: '', empty: true },
      { label: '', empty: true },
      { label: '', empty: true }
    ],
    message: [
      { label: 'Back', icon: '←', panel: 'home', accent: 'blue' },
      { label: 'Send', icon: '↵', action: 'Send', size: 'hero' },
      { label: 'New Line', icon: '↲', action: 'New Line', size: 'hero' },
      { label: 'Expand Compose', icon: '⤢', action: 'Expand Compose' },
      { label: 'Paste', icon: '⎘', action: 'Paste' },
      { label: 'Undo', icon: '↶', action: 'Undo' },
      { label: 'Bold', icon: 'B', action: 'Bold' },
      { label: 'Attach File', icon: '📎', action: 'Attach File' },
      { label: 'Insert Link', icon: '🔗', action: 'Insert Link' },
      { label: 'Chat', icon: '💬', action: 'Chat' }
    ]
  };

  function readParams() {
    var raw = window.location.search || window.location.hash.slice(1);
    return new URLSearchParams(raw.charAt(0) === '?' ? raw.slice(1) : raw);
  }
  function updateClock() {
    var timeText = $('timeText');
    if (!timeText) return;
    timeText.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function setStatusClass(name) {
    var dot = document.querySelector('.dot');
    if (!dot) return;
    dot.className = 'dot ' + String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  }
  function formatPresence(p) {
    if (!p) return '';
    var a = p.availability || '';
    var activity = p.activity || '';
    if (activity && activity !== a) return a + ' - ' + activity;
    return a || activity;
  }
  function formatMeeting(ev) {
    if (!ev) return 'None today';
    var start = ev.start && ev.start.dateTime ? new Date(ev.start.dateTime) : null;
    var when = start && !isNaN(start.getTime()) ? ' · ' + start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return (ev.subject || '(no subject)') + when;
  }
  function stripPrefix(text) {
    return String(text || '').replace(/^Teams status:\s*/i, '').replace(/^Next meeting:\s*/i, '');
  }
  function graphFetch(path, token) {
    return fetch('https://graph.microsoft.com/v1.0' + path, {
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + token }
    }).then(function (r) {
      if (!r.ok) throw new Error('Graph HTTP ' + r.status);
      return r.json();
    });
  }
  function updateGraphStatus() {
    if (!graphToken) {
      $('statusText').textContent = stripPrefix(params.get('statusText') || 'placeholder');
      $('nextMeetingText').textContent = stripPrefix(params.get('nextMeetingText') || 'placeholder');
      return;
    }
    graphFetch('/me/presence', graphToken)
      .then(function (presence) {
        var text = formatPresence(presence);
        $('statusText').textContent = text || 'Unavailable';
        setStatusClass(presence && (presence.activity || presence.availability));
      })
      .catch(function (err) {
        $('statusText').textContent = (err && err.message) || 'Token/error';
        setStatusClass('offline');
      });

    var start = new Date();
    var end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    var q = new URLSearchParams({
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      '$select': 'subject,start,isOnlineMeeting,onlineMeeting',
      '$orderby': 'start/dateTime',
      '$top': '1'
    });
    graphFetch('/me/calendarView?' + q.toString(), graphToken)
      .then(function (data) {
        $('nextMeetingText').textContent = formatMeeting(data.value && data.value[0]);
      })
      .catch(function () {
        $('nextMeetingText').textContent = 'Token/error';
      });
  }

  function launchAction(label) {
    var names = [label].concat(actionAliases[label] || []);
    var i = null;
    for (var n = 0; n < names.length; n++) {
      if (actionIndex[names[n]] != null) { i = actionIndex[names[n]]; break; }
    }
    if (i == null) return;
    fetch('/launch?i=' + encodeURIComponent(i), { cache: 'no-store' }).catch(function () {});
  }
  function switchPanel(name) {
    if (!panels[name] || name === activePanel) return;
    activePanel = name;
    renderPanel();
  }
  function buttonHtml(item, i) {
    if (item.empty) return '<button class="tile empty" aria-hidden="true"></button>';
    var cls = 'tile' + (item.size === 'hero' ? ' hero' : '') + (item.panel ? ' panel-link' : '') + (item.tone ? ' ' + item.tone : '') + (item.accent ? ' accent-' + item.accent : '');
    return '<button class="' + cls + '" data-i="' + i + '">'
      + '<span class="ic">' + esc(item.icon || '▫') + '</span>'
      + '<span class="lb">' + esc(item.label || '') + '</span>'
      + '</button>';
  }
  function renderPanel() {
    var stage = $('panelStage');
    var title = $('panelTitle');
    var names = { home: 'Home', call: 'Call controls', nav: 'App navigation', status: 'Status + info', calendar: 'Calendar', compose: 'New chat', team: 'Team / channel', meeting: 'Join meeting', calls: 'Calls', message: 'Send message' };
    if (!stage) return;
    if (title) title.textContent = names[activePanel] || 'Home';
    stage.classList.remove('slide-in');
    void stage.offsetWidth;
    stage.innerHTML = panels[activePanel].map(buttonHtml).join('');
    stage.classList.add('slide-in');
    stage.querySelectorAll('.tile[data-i]').forEach(function (btn) {
      btn.onclick = function () {
        var item = panels[activePanel][parseInt(btn.dataset.i, 10)];
        btn.classList.add('hit');
        window.setTimeout(function () { btn.classList.remove('hit'); }, 180);
        if (item.action) launchAction(item.action);
        if (item.refresh) updateGraphStatus();
        if (item.panel) switchPanel(item.panel);
      };
    });
  }
  function pollActions() {
    fetch('/apptiles', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        actionIndex = {};
        (data.tiles || []).forEach(function (t, i) {
          if (t && t.label && t.type) actionIndex[t.label] = i;
        });
      })
      .catch(function () {});
  }

  var params = readParams();
  graphToken = params.get('graphToken') || '';
  $('statusText').textContent = stripPrefix(params.get('statusText') || 'placeholder');
  $('nextMeetingText').textContent = stripPrefix(params.get('nextMeetingText') || 'placeholder');
  updateGraphStatus();
  updateClock();
  pollActions();
  renderPanel();
  window.setInterval(updateClock, 1000);
  window.setInterval(updateGraphStatus, 60000);
  window.setInterval(pollActions, 3000);
}());
