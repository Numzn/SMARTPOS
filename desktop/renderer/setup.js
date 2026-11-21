'use strict';

// Server-setup page. Runs under the strict CSP (no inline script) and talks to
// the main process only through the allowlisted window.numzDesktop bridge.
(function () {
  const bridge = window.numzDesktop;
  const form = document.getElementById('form');
  const input = document.getElementById('url');
  const message = document.getElementById('message');
  const testBtn = document.getElementById('test');
  const saveBtn = document.getElementById('save');
  const versionEl = document.getElementById('version');

  function show(text, kind) {
    message.textContent = text;
    message.className = kind || '';
  }
  function busy(isBusy) {
    testBtn.disabled = isBusy;
    saveBtn.disabled = isBusy;
  }

  if (!bridge) {
    show('This page can only be used inside the NUMZ POS desktop application.', 'err');
    busy(true);
    return;
  }

  bridge.app.getInfo().then((i) => {
    versionEl.textContent = 'NUMZ POS ' + i.version;
  }).catch(() => {});
  bridge.config.get().then((c) => {
    if (c.backendUrl) input.value = c.backendUrl;
  }).catch(() => {});

  testBtn.addEventListener('click', async () => {
    busy(true);
    show('Testing…');
    try {
      const r = await bridge.config.testBackend(input.value);
      show(r.ok ? 'Connected (' + r.latencyMs + ' ms).' : r.error, r.ok ? 'ok' : 'err');
    } catch (e) {
      show(e.message, 'err');
    } finally {
      busy(false);
    }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    busy(true);
    show('Saving…');
    try {
      const r = await bridge.config.setBackendUrl(input.value);
      if (!r.ok) {
        show(r.error, 'err');
        busy(false);
        return;
      }
      window.location.href = '/';
    } catch (e) {
      show(e.message, 'err');
      busy(false);
    }
  });
})();
