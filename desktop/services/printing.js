'use strict';

const {
  sendRaw: defaultSendRaw,
  applyDrawerPolicy,
  buildTestPage,
  looksLikeReceiptViewModel,
  DRAWER_KICK,
} = require('./escposPrinter');

/**
 * Print orchestration for the desktop. Each operation returns a plain result
 * object ({ ok, method?, error? }) instead of throwing, so the renderer can
 * always show an honest message and fall back to the existing browser path.
 *
 * Capability matrix (what is real vs. not):
 *  - ESCPOS_NETWORK: receipt bytes + drawer pulse sent over TCP to a LAN printer.
 *  - SYSTEM: the rendered receipt page is printed through a Windows printer
 *    driver (silently when a printer is named). Raw drawer pulses are NOT
 *    possible through a driver in this version, and are reported as such.
 *  - NONE: nothing configured; the renderer falls back to the system print dialog.
 */
function createPrintService({ getConfig, engine, sendRaw = defaultSendRaw }) {
  function escposTarget() {
    const cfg = getConfig().printer;
    if (cfg.mode !== 'ESCPOS_NETWORK' || !cfg.host) return null;
    return cfg;
  }

  async function printReceipt(viewModel) {
    const cfg = getConfig().printer;
    if (cfg.mode !== 'ESCPOS_NETWORK') {
      // Tell the renderer to print the on-screen receipt instead.
      return { ok: true, method: 'page' };
    }
    if (!looksLikeReceiptViewModel(viewModel)) {
      return { ok: false, error: 'The receipt data was not in the expected format.' };
    }
    try {
      const raw = engine.buildEscPosCommands(viewModel);
      const data = applyDrawerPolicy(raw, cfg.openDrawerOnCash);
      await sendRaw({ host: cfg.host, port: cfg.port, data });
      return { ok: true, method: 'escpos' };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : 'Printing failed.' };
    }
  }

  async function testPrinter() {
    const cfg = escposTarget();
    if (!cfg) {
      return { ok: false, error: 'Choose "Network receipt printer (ESC/POS)" and save before testing.' };
    }
    try {
      await sendRaw({ host: cfg.host, port: cfg.port, data: buildTestPage() });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : 'Printing failed.' };
    }
  }

  async function openDrawer() {
    const cfg = getConfig().printer;
    if (cfg.mode === 'ESCPOS_NETWORK' && cfg.host) {
      try {
        await sendRaw({ host: cfg.host, port: cfg.port, data: DRAWER_KICK });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : 'Could not open the drawer.' };
      }
    }
    return {
      ok: false,
      error:
        'A cash drawer can only be opened through a network ESC/POS printer in this version. ' +
        'Drivers installed in Windows cannot send the drawer command.',
    };
  }

  /** @param {Electron.WebContents} webContents */
  function printCurrentPage(webContents) {
    const cfg = getConfig().printer;
    const silent = cfg.mode === 'SYSTEM' && !!cfg.systemPrinterName;
    return new Promise((resolve) => {
      try {
        webContents.print(
          {
            silent,
            deviceName: silent ? cfg.systemPrinterName : undefined,
            printBackground: true,
            margins: { marginType: 'none' },
          },
          (success, failureReason) => {
            if (success) resolve({ ok: true, method: silent ? 'system-silent' : 'system-dialog' });
            else resolve({ ok: false, error: failureReason || 'Printing was cancelled or failed.' });
          }
        );
      } catch (e) {
        resolve({ ok: false, error: e && e.message ? e.message : 'Printing failed.' });
      }
    });
  }

  /** @param {Electron.WebContents} webContents */
  async function listPrinters(webContents) {
    try {
      const printers = await webContents.getPrintersAsync();
      return {
        ok: true,
        printers: printers.map((p) => ({
          name: String(p.name),
          displayName: String(p.displayName || p.name),
          isDefault: p.isDefault === true,
        })),
      };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : 'Could not list printers.', printers: [] };
    }
  }

  return { printReceipt, testPrinter, openDrawer, printCurrentPage, listPrinters };
}

module.exports = { createPrintService };
