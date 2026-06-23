  function $(id){ return document.getElementById(id); }
  function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  var ICON = {
    prev: '<svg viewBox="0 0 24 24"><path d="M7 6h2.4v12H7z"/><path d="M20 6v12l-9-6z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M14.6 6H17v12h-2.4z"/><path d="M4 6v12l9-6z"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
    pause:'<svg viewBox="0 0 24 24"><path d="M6 5h4.2v14H6z"/><path d="M13.8 5H18v14h-4.2z"/></svg>'
  };
  $('bPrev').innerHTML = ICON.prev; $('bNext').innerHTML = ICON.next; setPlayIcon(ICON.pause);
  function media(cmd){ fetch('/media/' + cmd, { cache: 'no-store' }).catch(function(){}); }
  function setPlayIcon(icon){ $('bPlay').innerHTML = icon; $('bPause').innerHTML = icon; }
  function togglePlayPause(){ media('playpause'); var p = $('bPlay').innerHTML === ICON.pause; setPlayIcon(p ? ICON.play : ICON.pause); }
  $('bPrev').onclick = function(){ media('prev'); };
  $('bNext').onclick = function(){ media('next'); };
  $('bPause').onclick = togglePlayPause;
  $('bPlay').onclick = togglePlayPause;

  function setArt(url){
    var img = $('artImg');
    if (url){ if (img.getAttribute('src') !== url) img.src = url; img.style.display = 'block'; }   // covers the 🎵 placeholder
    else { img.removeAttribute('src'); img.style.display = 'none'; }                                // no art -> show the 🎵 placeholder
  }
  function renderNP(s){
    if (!s || !s.title){
      $('mTitle').textContent = 'Nothing playing'; $('mArtist').textContent = '—';
      $('mStatus').textContent = '—'; $('mApp').textContent = ''; setPlayIcon(ICON.play); setArt(null); return;
    }
    $('mTitle').textContent = s.title;
    $('mArtist').textContent = s.artist || '—';
    $('mStatus').textContent = s.status || '—';
    setPlayIcon((s.status === 'Playing') ? ICON.pause : ICON.play);
    var app = (s.app || '').replace(/\._crx_.*/, '').replace(/!.*/, '').replace(/\.exe$/i, '');
    $('mApp').textContent = app ? ('· ' + app) : '';
    setArt(s.art);
  }

  function renderGrid(d){
    var host = $('grid'), cols = d.cols || 2, rows = d.rows || 2, n = cols * rows, tiles = d.tiles || [];
    host.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)';
    host.style.gridTemplateRows = 'repeat(' + rows + ',1fr)';
    var html = '';
    for (var i = 0; i < n; i++){
      var t = tiles[i];
      if (t && t.type && t.cover == null){
        var ic = t.iconSrc ? '<div class="ic"><img src="' + esc(t.iconSrc) + '"></div>' : '<div class="ic">' + esc(t.icon || '▫️') + '</div>';
        html += '<div class="tile" data-i="' + i + '">' + ic + '<div class="lb">' + esc(t.label || '') + '</div></div>';
      } else {
        html += '<div class="tile empty"></div>';
      }
    }
    host.innerHTML = html;
    host.querySelectorAll('.tile[data-i]').forEach(function(el){
      el.onclick = function(){ fetch('/launch?i=' + el.getAttribute('data-i'), { cache: 'no-store' }).catch(function(){}); };
    });
  }

  function pollNP(){
    fetch('/nowplaying', { cache: 'no-store' }).then(function(r){ return r.json(); })
      .then(function(s){ $('recon').classList.remove('show'); renderNP(s); })
      .catch(function(){ $('recon').classList.add('show'); });
  }
  function pollGrid(){
    fetch('/musictiles', { cache: 'no-store' }).then(function(r){ return r.json(); }).then(renderGrid).catch(function(){});
  }
  pollNP(); pollGrid();
  setInterval(pollNP, 1500);
  setInterval(pollGrid, 3000);   // pick up edits made in the editor
