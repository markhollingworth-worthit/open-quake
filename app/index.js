  const panelApi = window.openQuakePanel;
  const grid = document.getElementById('grid'), vol = document.getElementById('vol'), web = document.getElementById('web');
  const selector = document.getElementById('selector'), selitems = document.getElementById('selitems');
  const intro = document.getElementById('intro'), introok = document.getElementById('introok');
  let cfg = { cols: 8, rows: 2, tiles: [] };
  let grids = [], activeId = null, rotEnabled = false, rotRunning = false, introOpen = false;
  let armed = false, idleT = null, lastHit = -1, volT = null;
  let selOpen = false, selIdx = 0, selAutoClose = null;
  let webMode = false, curUrl = '', webReady = false, webDown = false, lastWeb = { x: 0, y: 0 }, webIdle = null;
  let haToken = '', haInject = false, webExternalLinks = false, webAttached = false, pendingWebUrl = null;
  // The <webview> can't be navigated until its first dom-ready — a programmatic src set during the
  // initial about:blank load is silently dropped. Gate the first dashboard navigation on that, so a
  // dashboard set as the start page actually loads instead of sitting on about:blank (a black panel).
  function navWeb(url) { if (webAttached) web.src = url; else pendingWebUrl = url; }
  web.addEventListener('dom-ready', () => {
    webReady = true;
    if (!webAttached) { webAttached = true; const u = pendingWebUrl; pendingWebUrl = null; if (u) web.src = u; }
  });
  // Home Assistant has no keyboard on the panel — if a long-lived token is set, seed HA's auth into
  // localStorage so it loads signed-in, then reload into the dashboard. (Standard HA kiosk technique.)
  web.addEventListener('did-finish-load', () => {
    if (!haInject || !haToken) return;
    haInject = false;
    let origin = ''; try { origin = new URL(curUrl).origin; } catch (e) { return; }
    const tok = { access_token: haToken, token_type: 'Bearer', expires_in: 315360000, hassUrl: origin, clientId: null, expires: Date.now() + 315360000000, refresh_token: '' };
    web.executeJavaScript(`try{localStorage.setItem('hassTokens', ${JSON.stringify(JSON.stringify(tok))});location.replace(${JSON.stringify(curUrl)});}catch(e){}`).catch(() => {});
  });

  // ---- "open clicked links in my PC browser" (per-dashboard toggle) ----
  // When a dashboard page has linksExternal set, a link the user taps opens in the host's default
  // browser instead of navigating the on-panel webview — e.g. tapping a helpdesk ticket pops it up
  // on the PC while the board stays live on the device. Three paths cover every way a link opens:
  //   • a clicked <a href> — caught in the capture phase by an injected listener, funneled out via a
  //     console-message tag (the guest has no nodeIntegration, so the console is the host channel);
  //   • window.open / target=_blank the page does itself — the webview's new-window event;
  //   • a JS navigation away from the board (location = …) — will-navigate, which we abort + restore.
  web.addEventListener('new-window', (e) => { if (webExternalLinks && e.url) panelApi.openExternal(e.url); });
  web.addEventListener('will-navigate', (e) => {
    if (webExternalLinks && webReady && e.url && e.url !== curUrl) {
      panelApi.openExternal(e.url);
      try { web.stop(); web.src = curUrl; } catch (er) {}       // abort the panel nav, keep the board up
    }
  });
  web.addEventListener('console-message', (e) => {
    if (webExternalLinks && e.message && e.message.indexOf('OQX_OPEN::') === 0) panelApi.openExternal(e.message.slice(10));
  });
  web.addEventListener('did-finish-load', () => {
    if (!webExternalLinks) return;
    web.executeJavaScript("(function(){if(window.__oqx)return;window.__oqx=1;document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(a&&/^https?:/i.test(a.href)){e.preventDefault();e.stopPropagation();console.log('OQX_OPEN::'+a.href);}},true);})();").catch(function(){});
  });

  // ---- display orientation: rotate only when the panel is a portrait window ----
  function layoutStage() {
    const stage = document.getElementById('stage');
    const w = window.innerWidth, h = window.innerHeight;
    // Portrait display (e.g. 480x1920): rotate the 1920x480 stage 90° to fill it.
    // Landscape display (1920x480, Windows Orientation = Landscape): no rotation, so the
    // OS mouse cursor and the content agree (otherwise the cursor reads 90° off).
    stage.style.transform = (h > w) ? `translate(${w}px, 0) rotate(90deg)` : 'none';
  }
  window.addEventListener('resize', layoutStage);
  layoutStage();

  // ---- active grid ----
  function build() {
    grid.style.gridTemplateColumns = `repeat(${cfg.cols},1fr)`;
    grid.style.gridTemplateRows = `repeat(${cfg.rows},1fr)`;
    grid.innerHTML = '';
    cfg.tiles.forEach((t, i) => {
      if (t && t.cover != null) return;                        // covered by a merged tile
      const col = i % cfg.cols, row = Math.floor(i / cfg.cols);
      const w = (t && t.w) || 1, h = (t && t.h) || 1;
      const d = document.createElement('div');
      const empty = !t || !t.type;
      d.className = 'tile' + (empty ? ' empty' : '') + ((w > 1 || h > 1) ? ' span' : '');
      d.dataset.i = i;
      d.style.gridColumn = `${col + 1} / span ${w}`;
      d.style.gridRow = `${row + 1} / span ${h}`;
      if (!empty) {                                            // build via DOM nodes (never innerHTML) so a config-supplied label/icon can't inject markup
        if (t.iconSrc) { const im = document.createElement('img'); im.className = 'ic-img'; im.src = t.iconSrc; d.appendChild(im); }
        else { const icd = document.createElement('div'); icd.className = 'ic'; icd.textContent = t.icon || '▫️'; d.appendChild(icd); }
        const lb = document.createElement('div'); lb.className = 'lb'; lb.textContent = t.label || ''; d.appendChild(lb);
      }
      grid.appendChild(d);
    });
  }
  panelApi.onGrid(g => {
    cfg = g;
    if (g && g.kind === 'web') {            // dashboard page -> show the webview
      webMode = true; grid.style.display = 'none'; web.classList.add('show');
      const auth = g.auth || {};
      haToken = auth.type === 'ha' ? (auth.token || '') : '';   // HA seeds localStorage; basic/header handled in main
      webExternalLinks = !!g.linksExternal;                     // route clicked links to the PC browser (per-page toggle)
      const url = g.url || 'about:blank';
      if (url !== curUrl) { curUrl = url; webReady = false; haInject = !!haToken; navWeb(url); }
    } else {                                // tile grid
      webMode = false; web.classList.remove('show'); grid.style.display = 'grid'; build();
    }
  });
  panelApi.onGridList(d => { grids = d.grids; activeId = d.activeId; if (selOpen) renderWheel(); });
  panelApi.onRotation(r => { rotEnabled = !!r.enabled; rotRunning = !!r.running; if (selOpen) renderWheel(); });

  // ---- first-run intro overlay (one-time "double-click the knob" hint) ----
  panelApi.onIntro(() => { if (introOpen) return; introOpen = true; intro.classList.add('open'); });
  function dismissIntro() { if (!introOpen) return; introOpen = false; intro.classList.remove('open'); panelApi.introDone(); }
  introok.addEventListener('click', dismissIntro);   // PC mouse

  // ---- touch -> launch ----
  function tileAt(sx, sy) {
    const col = Math.floor(sx / (1920 / cfg.cols)), row = Math.floor(sy / (480 / cfg.rows));
    if (col < 0 || col >= cfg.cols || row < 0 || row >= cfg.rows) return -1;
    let idx = row * cfg.cols + col;
    const t = cfg.tiles[idx];
    if (t && t.cover != null) idx = t.cover;                  // covered cell -> its merged owner
    return idx;
  }
  function highlight(i) {
    if (i === lastHit) return;
    if (lastHit >= 0) { const p = grid.querySelector(`[data-i="${lastHit}"]`); if (p) p.classList.remove('hit'); }
    if (i >= 0 && cfg.tiles[i] && cfg.tiles[i].type) { const el = grid.querySelector(`[data-i="${i}"]`); if (el) el.classList.add('hit'); }
    lastHit = i;
  }
  panelApi.onTouch(pts => {
    if (introOpen) { if (pts.some(p => p.action === 1)) dismissIntro(); return; }   // any tap dismisses the intro
    if (selOpen) return; // ignore touch while picking a page
    const p = pts.find(p => p.action === 1) || pts[0]; if (!p) return;
    if (webMode) return webTouch(p);        // dashboard: forward as mouse to the webview
    const i = tileAt(p.x, 480 - p.y);
    highlight(i);
    if (!armed && i >= 0 && cfg.tiles[i] && cfg.tiles[i].type) { armed = true; panelApi.launch(cfg.tiles[i]); }
    clearTimeout(idleT);
    idleT = setTimeout(() => { armed = false; highlight(-1); }, 180);
  });

  // ---- PC mouse -> launch (the panel is a real display; let the cursor click tiles too) ----
  grid.addEventListener('click', (e) => {
    if (selOpen || webMode) return;                  // ignore while picking a page / on dashboards (webview clicks natively)
    const el = e.target.closest && e.target.closest('[data-i]');
    if (!el) return;
    const i = parseInt(el.dataset.i, 10);
    if (i >= 0 && cfg.tiles[i] && cfg.tiles[i].type) {
      highlight(i);
      panelApi.launch(cfg.tiles[i]);
      setTimeout(() => highlight(-1), 180);
    }
  });

  // ---- dashboard touch -> mouse (tap = click, drag = move) ----
  function webTouch(p) {
    if (!webReady) return;
    const x = Math.max(0, Math.min(1920, p.x)), y = Math.max(0, Math.min(480, 480 - p.y));
    lastWeb = { x, y }; clearTimeout(webIdle);
    try {
      if (p.action === 1) {
        if (!webDown) { webDown = true; web.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); }
        else web.sendInputEvent({ type: 'mouseMove', x, y });
        webIdle = setTimeout(webRelease, 140);   // finger lifted without an explicit up frame
      } else { webRelease(); }
    } catch (e) {}
  }
  function webRelease() {
    clearTimeout(webIdle);
    if (webDown) { webDown = false; try { web.sendInputEvent({ type: 'mouseUp', x: lastWeb.x, y: lastWeb.y, button: 'left', clickCount: 1 }); } catch (e) {} }
  }

  // ---- dial selector ----
  // wheel = a rotation on/off toggle (only when rotation is enabled in settings) + the pages
  function wheelItems() { return (rotEnabled ? [{ rot: true }] : []).concat(grids); }
  function renderWheel() {
    const items = wheelItems();
    selitems.innerHTML = '';
    items.forEach((it, i) => {
      const d = document.createElement('div');
      d.className = 'selitem' + (i === selIdx ? ' sel' : '');
      d.textContent = it.rot ? (rotRunning ? '⏸ Rotation: ON' : '▶ Rotation: OFF') : it.name;
      selitems.appendChild(d);
    });
    selitems.style.transform = `translateY(${-selIdx * 76}px)`;
  }
  function openSelector() {
    const items = wheelItems();
    if (!items.length) return;
    selOpen = true;
    const gi = grids.findIndex(g => g.id === activeId);
    selIdx = gi >= 0 ? (rotEnabled ? 1 : 0) + gi : 0;     // land on the live page (offset past the rotation row)
    selector.classList.add('open'); renderWheel(); resetAutoClose();
  }
  function closeSelector() { selOpen = false; selector.classList.remove('open'); clearTimeout(selAutoClose); }
  function moveSelector(dir) { selIdx = Math.min(wheelItems().length - 1, Math.max(0, selIdx + dir)); renderWheel(); resetAutoClose(); }
  function confirmSelector() {
    const it = wheelItems()[selIdx]; closeSelector();
    if (it && it.rot) panelApi.toggleRotation();
    else if (it) panelApi.switchGrid(it.id);
  }
  function resetAutoClose() { clearTimeout(selAutoClose); selAutoClose = setTimeout(closeSelector, 4500); }

  // ---- knob ----
  // The knob does click-type detection in hardware: press index 1 = single-click, 2 = double-click.
  panelApi.onKnob(k => {
    if (introOpen) {   // teach by doing: a double-click clears the intro and opens the page menu; ignore other knob input
      if (k.type === 'press' && k.index === 2) { dismissIntro(); openSelector(); }
      return;
    }
    if (k.type === 'hold') {   // press-and-hold -> push-to-talk; the served chat page defines window.pttStart/Stop
      if (webMode && webReady) web.executeJavaScript(k.phase === 'start' ? 'window.pttStart&&window.pttStart()' : 'window.pttStop&&window.pttStop()').catch(function () {});
      return;
    }
    if (k.type === 'rotate') {
      if (selOpen) { moveSelector(k.dir > 0 ? -1 : 1); }                  // CW scrolls down the list
      else if (webMode && webReady) {
        // Native wheel event at center: Chromium routes it to whatever element is scrollable
        // under that point, so inner scroll containers (Grafana/HA panels) scroll too.
        try { web.sendInputEvent({ type: 'mouseWheel', x: 960, y: 240, deltaX: 0, deltaY: k.dir > 0 ? -120 : 120, wheelTicksX: 0, wheelTicksY: k.dir > 0 ? -1 : 1, hasPreciseScrollingDeltas: true, canScroll: true }); } catch (e) {}
      }
      else { panelApi.volume(k.dir > 0 ? 1 : -1); flashVol(k.dir > 0 ? '🔊 +' : '🔉 −'); }
      return;
    }
    if (k.type === 'press') {
      if (selOpen) { confirmSelector(); return; }           // any press picks the highlighted grid
      if (k.index === 2) { openSelector(); }                // double-click -> grid selector
      else { panelApi.volume('mute'); flashVol('🔇'); }  // single-click -> mute
    }
  });
  function flashVol(t) { vol.textContent = t; vol.style.opacity = 1; clearTimeout(volT); volT = setTimeout(() => vol.style.opacity = 0, 500); }
