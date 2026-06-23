  var CIRC = 376.991;   // 2·π·60
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function num(v){ return (v == null || !isFinite(v)) ? null : v; }
  function pct(v){ return v == null ? '—' : Math.round(v) + '%'; }
  function temp(v){ return v == null ? '—' : Math.round(v) + '°'; }
  function bytes(b){ if (b == null || !isFinite(b)) return ['—','']; var u=['B','KB','MB','GB','TB'],i=0,n=b;
    while (n>=1024 && i<u.length-1){ n/=1024; i++; } return [n.toFixed(n<10&&i>0?1:0), u[i]]; }
  function bstr(b){ var x=bytes(b); return x[0]+(x[1]?' '+x[1]:''); }
  function rate(b){ if (b == null || !isFinite(b)) return ['—','']; var u=['B/s','KB/s','MB/s','GB/s'],i=0,n=b;
    while (n>=1024 && i<u.length-1){ n/=1024; i++; } return [n.toFixed(n<10&&i>0?1:0), u[i]]; }
  function setGauge(arc, val, scale){ var pctv = val==null ? null : Math.max(0,Math.min(100, val/(scale||1)*100));
    arc.style.strokeDasharray = CIRC; arc.style.strokeDashoffset = pctv==null ? CIRC : CIRC*(1-pctv/100); }


  function renderDisks(disks){
    var host = $('disks');
    if (!disks || !disks.length){ host.innerHTML = '<div class="dim" style="font-size:14px">—</div>'; return; }
    host.innerHTML = disks.map(function(d){
      var p = num(d.usePct);
      var col = p==null ? '#2a3a4d' : (p>90 ? '#ff6b6b' : p>75 ? '#ffb454' : '#7CFFB2');
      return '<div class="drow"><div class="dhead"><span class="k">' + esc(d.mount||'?') + '</span>'
        + '<span class="v">' + bstr(d.usedBytes) + ' / ' + bstr(d.totalBytes) + ' · ' + pct(p) + '</span></div>'
        + '<div class="bar"><div class="barfill" style="width:' + (p==null?0:Math.min(100,p)) + '%;background:' + col + '"></div></div></div>';
    }).join('');
  }

  function render(s){
    var cpu = s.cpu||{}, gpu = s.gpu||{};
    $('cpuLoadVal').textContent = pct(num(cpu.loadPct)); setGauge($('cpuLoadArc'), num(cpu.loadPct), 100);
    $('cpuTempVal').textContent = temp(num(cpu.tempC)); setGauge($('cpuTempArc'), num(cpu.tempC), 100);
    $('gpuLoadVal').textContent = pct(num(gpu.loadPct)); setGauge($('gpuLoadArc'), num(gpu.loadPct), 100);
    $('gpuTempVal').textContent = temp(num(gpu.tempC)); setGauge($('gpuTempArc'), num(gpu.tempC), 100);
    $('gpuName').textContent = gpu.name || 'graphics';

    var mem = s.mem;
    if (mem && mem.totalBytes){
      var freeB = mem.totalBytes - mem.usedBytes;
      $('memTotal').textContent = bstr(mem.totalBytes);
      $('memUsed').textContent = bstr(mem.usedBytes); $('memUsedPct').textContent = pct(mem.usedBytes/mem.totalBytes*100);
      $('memFree').textContent = bstr(freeB); $('memFreePct').textContent = pct(freeB/mem.totalBytes*100);
      $('memUsedBar').style.width = Math.min(100, mem.usedBytes/mem.totalBytes*100) + '%';
      $('memFreeBar').style.width = Math.min(100, freeB/mem.totalBytes*100) + '%';
    } else { ['memTotal','memUsed','memUsedPct','memFree','memFreePct'].forEach(function(i){ $(i).textContent='—'; });
      $('memUsedBar').style.width='0%'; $('memFreeBar').style.width='0%'; }

    renderDisks(s.disks);

    var p = s.proc;
    $('procTotal').textContent = (p && p.total!=null) ? p.total : '—';

    var net = s.net;
    var dn = rate(net?net.rxBytesSec:null), up = rate(net?net.txBytesSec:null);
    $('netDown').textContent = dn[0]; $('netDownU').textContent = dn[1];
    $('netUp').textContent = up[0]; $('netUpU').textContent = up[1];

    var b = s.battery;
    if (b == null){ $('battBlock').style.display = 'none'; }      // desktop / no battery
    else { $('battBlock').style.display = '';
      $('battPct').textContent = pct(num(b.percent));
      $('battFill').style.width = (num(b.percent)==null?0:Math.max(0,Math.min(100,b.percent))) + '%';
      $('battState').textContent = b.charging ? 'charging' : 'on battery'; }
  }

  function tick(){
    fetch('/metrics', { cache: 'no-store' }).then(function(r){ return r.json(); })
      .then(function(s){ $('recon').classList.remove('show'); render(s); })
      .catch(function(){ $('recon').classList.add('show'); });
  }
  tick();
  setInterval(tick, 1000);
