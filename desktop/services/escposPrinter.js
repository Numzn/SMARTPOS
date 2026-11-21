'use strict';

const net = require('net');

/**
 * Local ESC/POS output from the desktop's main process.
 *
 * Why this exists in the desktop instead of reusing the backend's
 * lib/print/escposSend.js: the backend usually runs on a server that cannot
 * reach a printer on the shop's LAN. The bytes themselves still come from the
 * shared @smartpos/receipt-engine, so receipts are identical to the web path.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** ESC p 0 25 250: pulse drawer pin 2 (same bytes the receipt engine emits). */
const DRAWER_KICK = Uint8Array.from([ESC, 0x70, 0x00, 0x19, 0xfa]);

function sendRaw({ host, port, data, timeoutMs = 8000, netImpl = net }) {
  return new Promise((resolve, reject) => {
    const socket = new netImpl.Socket();
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(true);
    };
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => done(new Error('Printer connection timed out.')));
    socket.on('error', (e) => done(new Error(`Printer error: ${e.code || e.message}`)));
    socket.connect(port, host, () => {
      socket.write(Buffer.from(data), (err) => {
        if (err) return done(err);
        socket.end(() => done(null));
      });
    });
  });
}

/**
 * The receipt engine always prepends a drawer pulse for CASH sales. Not every
 * printer has a drawer attached, so the pulse is removed unless the operator
 * explicitly enabled it. Only the exact expected sequence directly after
 * `ESC @` is touched; any other layout is left unmodified.
 */
function applyDrawerPolicy(bytes, openDrawerOnCash) {
  if (openDrawerOnCash) return bytes;
  const init = [ESC, 0x40];
  const matchesInit = bytes[0] === init[0] && bytes[1] === init[1];
  const kickAt = 2;
  const matchesKick = DRAWER_KICK.every((b, i) => bytes[kickAt + i] === b);
  if (!matchesInit || !matchesKick) return bytes;
  const out = new Uint8Array(bytes.length - DRAWER_KICK.length);
  out.set(bytes.subarray(0, kickAt), 0);
  out.set(bytes.subarray(kickAt + DRAWER_KICK.length), kickAt);
  return out;
}

function buildTestPage(now = new Date()) {
  const enc = new TextEncoder();
  const lines = ['NUMZ POS', 'Printer test OK', now.toISOString().slice(0, 19).replace('T', ' ')];
  const parts = [Uint8Array.from([ESC, 0x40, ESC, 0x61, 1])];
  for (const l of lines) parts.push(enc.encode(l), Uint8Array.from([LF]));
  parts.push(Uint8Array.from([LF, LF, LF, GS, 0x56, 0x00])); // feed + full cut
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Cheap structural check so a malformed renderer payload fails cleanly, not mid-build. */
function looksLikeReceiptViewModel(vm) {
  return !!(
    vm &&
    typeof vm === 'object' &&
    vm.merchant && typeof vm.merchant.tradingName === 'string' &&
    vm.transaction && typeof vm.transaction === 'object' &&
    Array.isArray(vm.items) &&
    vm.totals && typeof vm.totals === 'object' &&
    vm.payment && typeof vm.payment.method === 'string' &&
    vm.fiscal && typeof vm.fiscal === 'object' &&
    vm.footer && typeof vm.footer === 'object' &&
    vm.receiptMeta && typeof vm.receiptMeta === 'object'
  );
}

module.exports = {
  sendRaw,
  applyDrawerPolicy,
  buildTestPage,
  looksLikeReceiptViewModel,
  DRAWER_KICK,
};
