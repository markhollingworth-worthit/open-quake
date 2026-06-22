(function () {
  function readParams() {
    var raw = window.location.search || window.location.hash.slice(1);
    return new URLSearchParams(raw.charAt(0) === '?' ? raw.slice(1) : raw);
  }

  var params = readParams();
  var accent = params.get('accent') || '#7CFFB2';
  var message = params.get('message') || 'Hello from a drop-in app';

  document.documentElement.style.setProperty('--accent', accent);
  document.getElementById('message').textContent = message;
}());
