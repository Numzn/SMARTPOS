'use strict';

const path = require('path');
const { normalizeBackendUrl, isLocalHost } = require('./backendUrl');

/**
 * Non-secret desktop configuration, persisted as JSON in the per-user data
 * directory (so it survives upgrades and is separate from the install folder).
 * Nothing secret belongs here: the auth token goes through secureStore.js.
 */

const PRINTER_MODES = Object.freeze(['NONE', 'SYSTEM', 'ESCPOS_NETWORK']);

const DEFAULT_CONFIG = Object.freeze({
  backendUrl: '',
  printer: Object.freeze({
    mode: 'NONE',
    systemPrinterName: '',
    host: '',
    port: 9100,
    openDrawerOnCash: false,
  }),
});

const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

/**
 * ESC/POS raw sockets are only ever opened to LAN-local printers: loopback,
 * RFC1918, single-label hostnames, or *.local / *.lan names.
 */
function isAllowedPrinterHost(host) {
  if (!HOST_RE.test(host)) return false;
  if (isLocalHost(host)) return true;
  const h = host.toLowerCase();
  if (!h.includes('.')) return true;
  return h.endsWith('.local') || h.endsWith('.lan');
}

function validatePrinterConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Printer settings must be an object.' };
  }
  const mode = input.mode;
  if (!PRINTER_MODES.includes(mode)) {
    return { ok: false, error: `Printer mode must be one of ${PRINTER_MODES.join(', ')}.` };
  }
  const openDrawerOnCash = input.openDrawerOnCash === true;
  const systemPrinterName =
    typeof input.systemPrinterName === 'string' ? input.systemPrinterName.trim().slice(0, 200) : '';
  const host = typeof input.host === 'string' ? input.host.trim() : '';
  const port = input.port === undefined || input.port === '' ? 9100 : Number(input.port);

  if (mode === 'ESCPOS_NETWORK') {
    if (!host) return { ok: false, error: 'Printer address is required for a network printer.' };
    if (!isAllowedPrinterHost(host)) {
      return {
        ok: false,
        error: 'Printer address must be a private network address (for example 192.168.1.50) or a local printer name.',
      };
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'Printer port must be a number between 1 and 65535.' };
    }
  }

  return {
    ok: true,
    value: {
      mode,
      systemPrinterName,
      host: mode === 'ESCPOS_NETWORK' ? host : '',
      port: mode === 'ESCPOS_NETWORK' ? port : 9100,
      openDrawerOnCash,
    },
  };
}

/** Merge a parsed file over defaults, discarding anything invalid or unknown. */
function sanitizeLoaded(raw) {
  const out = { backendUrl: '', printer: { ...DEFAULT_CONFIG.printer } };
  if (!raw || typeof raw !== 'object') return out;

  if (typeof raw.backendUrl === 'string') {
    const n = normalizeBackendUrl(raw.backendUrl);
    if (n.ok) out.backendUrl = n.origin;
  }
  if (raw.printer) {
    const p = validatePrinterConfig(raw.printer);
    if (p.ok) out.printer = p.value;
  }
  return out;
}

function createConfigStore({ dir, fs, defaults = {} }) {
  const file = path.join(dir, 'config.json');
  let state = null;

  function load() {
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      raw = null; // missing or corrupt: fall back to defaults, never crash startup
    }
    state = sanitizeLoaded(raw);
    // Operator/installer default only applies when the user has not chosen one.
    if (!state.backendUrl && defaults.backendUrl) {
      const n = normalizeBackendUrl(defaults.backendUrl);
      if (n.ok) state.backendUrl = n.origin;
    }
    return state;
  }

  function persist() {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file); // atomic replace: a crash never leaves half a file
  }

  function get() {
    if (!state) load();
    return { backendUrl: state.backendUrl, printer: { ...state.printer } };
  }

  function setBackendUrl(input) {
    const n = normalizeBackendUrl(input);
    if (!n.ok) return n;
    if (!state) load();
    state.backendUrl = n.origin;
    persist();
    return { ok: true, origin: n.origin };
  }

  function setPrinter(input) {
    const v = validatePrinterConfig(input);
    if (!v.ok) return v;
    if (!state) load();
    state.printer = v.value;
    persist();
    return { ok: true, value: { ...v.value } };
  }

  return { get, setBackendUrl, setPrinter, load, file };
}

module.exports = {
  createConfigStore,
  validatePrinterConfig,
  isAllowedPrinterHost,
  DEFAULT_CONFIG,
  PRINTER_MODES,
};
