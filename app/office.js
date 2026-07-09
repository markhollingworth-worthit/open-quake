(function () {
  var SCOPES = ['User.Read', 'Presence.Read', 'Calendars.Read', 'offline_access'];

  try {
    var q = new URLSearchParams(location.search);
    document.body.classList.toggle('light', q.get('_dark') === '0');
    var a = q.get('_accent') || '';
    if (/^#[0-9a-fA-F]{6}$/.test(a)) document.documentElement.style.setProperty('--accent', a);
  } catch (e) {}

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function status(text, bad) {
    $('status').textContent = text || '';
    $('status').classList.toggle('bad', !!bad);
  }
  function tokenUrl() {
    return '/api/oauth-tokens.json?provider=microsoft&scopes=' + encodeURIComponent(SCOPES.join(' '));
  }
  function authUrl() {
    return '/api/oauth-connect?provider=microsoft&scopes=' + encodeURIComponent(SCOPES.join(' '));
  }
  function graph(path, token) {
    return fetch('https://graph.microsoft.com/v1.0' + path, {
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + token.accessToken }
    }).then(function (r) {
      if (!r.ok) throw new Error('Graph ' + r.status);
      return r.json();
    });
  }
  function fmtTime(value) {
    if (!value) return '';
    try { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function presenceClass(value) {
    var v = String(value || '').toLowerCase();
    if (v.indexOf('available') >= 0) return 'available';
    if (v.indexOf('donotdisturb') >= 0) return 'dnd';
    if (v.indexOf('busy') >= 0) return 'busy';
    return '';
  }
  function renderEvents(items) {
    items = items || [];
    var html = '';
    for (var i = 0; i < 5; i++) {
      var ev = items[i];
      if (!ev) {
        html += '<div class="event"><div class="time"></div><div><div class="title"></div><div class="meta"></div></div></div>';
      } else {
        var where = ev.location && ev.location.displayName || '';
        html += '<div class="event"><div class="time">' + esc(fmtTime(ev.start && ev.start.dateTime)) + '</div><div><div class="title">' + esc(ev.subject || '(busy)') + '</div><div class="meta">' + esc(where || ev.showAs || '') + '</div></div></div>';
      }
    }
    $('events').innerHTML = html;
  }
  function showAuth(message) {
    $('auth').classList.remove('hidden');
    $('authMsg').textContent = message || '';
  }
  function hideAuth() {
    $('auth').classList.add('hidden');
  }
  function renderGrid(d) {
    var host = $('grid'), cols = d.cols || 2, rows = d.rows || 2, n = cols * rows, tiles = d.tiles || [];
    host.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)';
    host.style.gridTemplateRows = 'repeat(' + rows + ',1fr)';
    var html = '';
    for (var i = 0; i < n; i++) {
      var t = tiles[i];
      if (t && t.type && t.cover == null) {
        var ic = t.iconSrc ? '<div class="ic"><img src="' + esc(t.iconSrc) + '"></div>' : '<div class="ic">' + esc(t.icon || '□') + '</div>';
        html += '<div class="tile" data-i="' + i + '">' + ic + '<div class="lb">' + esc(t.label || '') + '</div></div>';
      } else {
        html += '<div class="tile empty"></div>';
      }
    }
    host.innerHTML = html;
    host.querySelectorAll('.tile[data-i]').forEach(function (el) {
      el.onclick = function () { fetch('/launch?i=' + el.getAttribute('data-i'), { cache: 'no-store' }).catch(function () {}); };
    });
  }
  function pollGrid() {
    fetch('/grid-tiles', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(renderGrid).catch(function () {});
  }
  function loadOffice() {
    fetch(tokenUrl(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (token) {
      if (!token || !token.ok || !token.accessToken) {
        status('Microsoft connection needed.', true);
        showAuth(token && token.error ? token.error : '');
        return;
      }
      hideAuth();
      status('Loading Microsoft 365...');
      var now = new Date();
      var end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      var calPath = '/me/calendarView?startDateTime=' + encodeURIComponent(now.toISOString()) + '&endDateTime=' + encodeURIComponent(end.toISOString()) + '&$orderby=start/dateTime&$top=5';
      Promise.all([
        graph('/me?$select=displayName,userPrincipalName', token),
        graph('/me/presence', token).catch(function () { return null; }),
        graph(calPath, token)
      ]).then(function (all) {
        var me = all[0], presence = all[1], cal = all[2];
        $('name').textContent = me.displayName || me.userPrincipalName || 'Office';
        var p = presence && (presence.availability || presence.activity) || 'Calendar';
        $('presence').textContent = p;
        $('presence').className = 'presence ' + presenceClass(p);
        renderEvents(cal && cal.value || []);
        status('');
      }).catch(function (e) {
        status(e.message || 'Microsoft Graph failed', true);
      });
    }).catch(function () {
      status('Could not reach Open-Quake OAuth service.', true);
    });
  }
  $('connect').onclick = function () {
    $('connect').disabled = true;
    $('authMsg').textContent = 'Opening Microsoft sign-in...';
    fetch(authUrl(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (r) {
      $('authMsg').textContent = r && r.ok ? 'Finish sign-in in the browser, then this deck will refresh.' : ((r && r.error) || 'Could not start sign-in.');
      setTimeout(loadOffice, 3000);
    }).catch(function () {
      $('authMsg').textContent = 'Could not start sign-in.';
    }).finally(function () {
      $('connect').disabled = false;
    });
  };
  pollGrid();
  loadOffice();
  setInterval(loadOffice, 60000);
  setInterval(pollGrid, 3000);
})();
