(function () {
  'use strict';
  var socket = null;
  var busy = false;
  var status = document.getElementById('status');
  function show(message) { status.textContent = message; }
  function evaluate(source) {
    return new Promise(function (resolve, reject) {
      window.__adobe_cep__.evalScript(source, function (reply) {
        if (reply === undefined || reply === 'EvalScript error.') reject(new Error('AE script dispatch failed'));
        else resolve(reply);
      });
    });
  }
  document.getElementById('disconnect').addEventListener('click', function () { if (socket) socket.close(); });
  document.getElementById('connection').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!window.__adobe_cep__) { show('Open this panel inside After Effects with CEP available.'); return; }
    if (socket && socket.readyState <= WebSocket.OPEN) { show('Disconnect the current session first.'); return; }
    var port = Number(document.getElementById('port').value);
    var token = document.getElementById('token').value;
    if (!Number.isInteger(port) || port < 1 || port > 65535 || token.length < 32) { show('Enter a valid port and session token.'); return; }
    var active = socket = new WebSocket('ws://127.0.0.1:' + port + '/ae');
    active.onopen = function () { active.send(JSON.stringify({ token: token })); token = ''; };
    active.onclose = function () { if (socket === active) show('Disconnected. Inspect AE if a call was running.'); };
    active.onerror = function () { show('Connection failed. Check the local server and port.'); };
    active.onmessage = async function (event) {
      var job;
      var ownsBusy = false;
      try {
        job = JSON.parse(event.data);
        if (job.type === 'connected') { document.getElementById('token').value = ''; show('Connected.'); return; }
        if (!job.id || !['status', 'list_comps', 'run_jsx'].includes(job.call) || typeof job.argsPath !== 'string' || typeof job.resultPath !== 'string') throw new Error('Invalid job');
        if (busy) throw new Error('Native call already running');
        busy = true;
        ownsBusy = true;
        var host = decodeURIComponent(window.location.pathname).replace(/\\/g, '/');
        if (/^\/[A-Za-z]:\//.test(host)) host = host.slice(1);
        host = host.replace(/\/client\/index\.html$/, '/host/aebridge.jsx');
        await evaluate('$.evalFile(new File(' + JSON.stringify(host) + ')); AEB.hostVersion;');
        var reply = await evaluate('AEB.dispatch(' + JSON.stringify(job.call) + ',' + JSON.stringify(job.argsPath) + ',' + JSON.stringify(job.resultPath) + ')');
        if (active.readyState === WebSocket.OPEN) active.send(JSON.stringify({ id: job.id, ok: reply === 'ok' }));
        show(reply === 'ok' ? 'Connected. Last call finished.' : 'Native dispatch failed; inspect AE.');
      } catch (error) {
        show(error.message || String(error));
        if (job && job.id && active.readyState === WebSocket.OPEN) active.send(JSON.stringify({ id: job.id, ok: false }));
      } finally { if (ownsBusy) busy = false; }
    };
  });
})();
