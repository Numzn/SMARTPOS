'use strict';

const { INVOKE_CHANNELS } = require('./channels');
const { isTrustedSender } = require('./senderValidation');
const { normalizeBackendUrl } = require('../services/backendUrl');
const { checkBackend } = require('../services/diagnostics');

/**
 * Registers every privileged IPC handler. Two defences apply to ALL of them:
 *  1. Sender validation: the call must come from the top-level frame of a page
 *     we serve (numzpos://app, or the dev server in development).
 *  2. Argument validation inside each handler, never trusting the renderer.
 * Handlers return plain data; errors thrown here reach the renderer as a
 * rejected promise with a short message and no stack.
 */
function registerIpc({ ipcMain, trustedOrigins, services, onOpenSetup, fetchImpl, log }) {
  const registered = [];

  function handle(channel, fn) {
    if (!INVOKE_CHANNELS.includes(channel)) throw new Error(`Channel not in allowlist: ${channel}`);
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event, trustedOrigins)) {
        log.warn(`Rejected IPC ${channel} from untrusted sender`);
        throw new Error('Untrusted sender.');
      }
      try {
        return await fn(event, ...args);
      } catch (e) {
        log.warn(`IPC ${channel} failed: ${e && e.message}`);
        throw new Error(e && e.message ? e.message : 'Operation failed.');
      }
    });
    registered.push(channel);
  }

  const { app, config, secureStore, printing, updater, diagnostics } = services;

  handle('app:getInfo', () => app.info());
  handle('app:openSetup', () => {
    onOpenSetup();
    return true;
  });

  handle('config:get', () => {
    const c = config.get();
    return { backendUrl: c.backendUrl, configured: !!c.backendUrl };
  });
  handle('config:setBackendUrl', (_e, url) => config.setBackendUrl(url));
  handle('config:testBackend', async (_e, url) => {
    const n = normalizeBackendUrl(url);
    if (!n.ok) return { ok: false, error: n.error };
    const r = await checkBackend(n.origin, fetchImpl);
    return r.reachable
      ? { ok: true, origin: n.origin, latencyMs: r.latencyMs }
      : { ok: false, error: 'Could not reach the server at that address.' };
  });

  handle('secureStore:get', (_e, key) => secureStore.get(key));
  handle('secureStore:set', (_e, key, value) => secureStore.set(key, value));
  handle('secureStore:delete', (_e, key) => secureStore.delete(key));

  handle('print:listPrinters', (e) => printing.listPrinters(e.sender));
  handle('print:currentPage', (e) => printing.printCurrentPage(e.sender));
  handle('print:receipt', (_e, vm) => printing.printReceipt(vm));
  handle('print:test', () => printing.testPrinter());
  handle('print:openDrawer', () => printing.openDrawer());

  handle('printers:getConfig', () => config.get().printer);
  handle('printers:setConfig', (_e, value) => config.setPrinter(value));

  handle('updates:getStatus', () => updater.getStatus());
  handle('updates:check', () => updater.check());
  handle('updates:download', () => updater.download());
  handle('updates:install', () => updater.install());

  handle('diagnostics:get', () => diagnostics());

  // Every allowlisted channel must have a handler, and vice versa.
  const missing = INVOKE_CHANNELS.filter((c) => !registered.includes(c));
  if (missing.length) throw new Error(`IPC channels without handlers: ${missing.join(', ')}`);
  return registered;
}

module.exports = { registerIpc };
