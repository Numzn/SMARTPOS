import type { ReceiptViewModel } from '../types';
import { formatCurrency } from '../formatCurrency';
import { copyLabel, receiptTitle, formatPaymentMethod } from '../receiptSections';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function textEncoder(): { encode(s: string): Uint8Array } {
  if (typeof TextEncoder !== 'undefined') {
    const enc = new TextEncoder();
    return { encode: (s) => enc.encode(s) };
  }
  return {
    encode: (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff)),
  };
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function cmd(...bytes: number[]): Uint8Array {
  return Uint8Array.from(bytes);
}

/** ESC p — pulse the cash drawer solenoid (pin 2, ~100ms on / ~1s off). */
function cashDrawerKick(): Uint8Array {
  return cmd(ESC, 0x70, 0x00, 0x19, 0xfa);
}

function line(text: string, enc: { encode(s: string): Uint8Array }): Uint8Array {
  return concat(enc.encode(text), cmd(LF));
}

function divider(char = '=', width = 42): Uint8Array {
  return line(char.repeat(width), textEncoder());
}

function center(text: string, enc: { encode(s: string): Uint8Array }): Uint8Array {
  return concat(cmd(ESC, 0x61, 1), line(text, enc), cmd(ESC, 0x61, 0));
}

/**
 * ESC/POS 2D symbol ("GS ( k") commands to print a QR code on the printer
 * itself — the printer's firmware does the QR encoding from raw data, no
 * bitmap rasterization needed. This is the same data the screen/A4 renderer
 * encodes into a QRCodeSVG (vm.fiscal.qrPayload), so the printed and
 * on-screen receipts carry an identical, independently-scannable QR code —
 * previously this path only printed "Scan QR on screen to verify" text,
 * meaning a receipt from a real network thermal printer had no fiscal QR at all.
 */
function qrCode(
  data: string,
  enc: { encode(s: string): Uint8Array },
  moduleSize = 6,
  errorCorrection: 'L' | 'M' | 'Q' | 'H' = 'M'
): Uint8Array {
  const bytes = enc.encode(data);
  const storeLen = bytes.length + 3; // "m" byte + data
  const ecLevel = { L: 48, M: 49, Q: 50, H: 51 }[errorCorrection];

  return concat(
    cmd(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00), // select model 2
    cmd(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize), // module size
    cmd(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, ecLevel), // error correction level
    cmd(GS, 0x28, 0x6b, storeLen & 0xff, (storeLen >> 8) & 0xff, 0x31, 0x50, 0x30), // store data
    bytes,
    cmd(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30) // print stored symbol
  );
}

/** Build ESC/POS command buffer for 80mm thermal printers from ReceiptViewModel. */
export function buildEscPosCommands(viewModel: ReceiptViewModel): Uint8Array {
  const vm = viewModel;
  const enc = textEncoder();
  const parts: Uint8Array[] = [];

  parts.push(cmd(ESC, 0x40)); // init

  if (vm.payment.method.toUpperCase() === 'CASH') {
    parts.push(cashDrawerKick());
  }

  const copy = copyLabel(vm);
  if (copy) {
    parts.push(center(copy, enc));
  }

  parts.push(center(vm.merchant.tradingName, enc));
  parts.push(center(receiptTitle(vm), enc));
  parts.push(divider());
  parts.push(line(`Store: ${vm.merchant.tradingName}`, enc));
  parts.push(line(`TPIN: ${vm.merchant.tpin}`, enc));
  parts.push(line(`Branch: ${vm.merchant.branchName}`, enc));
  parts.push(divider('-'));
  parts.push(line(`Date: ${vm.transaction.date}  Time: ${vm.transaction.time}`, enc));
  parts.push(line(`Cashier: ${vm.transaction.cashier}`, enc));
  if (vm.transaction.receiptNo) {
    parts.push(line(`Receipt: ${vm.transaction.receiptNo}`, enc));
  }
  parts.push(divider('-'));

  for (const item of vm.items) {
    parts.push(line(item.name, enc));
    parts.push(
      line(
        `  ${item.qty} x ${formatCurrency(item.unitPrice)} = ${formatCurrency(item.lineTotal)}`,
        enc
      )
    );
  }

  parts.push(divider('-'));
  parts.push(line(`Subtotal: ${formatCurrency(vm.totals.subtotal)}`, enc));
  parts.push(line(`${vm.totals.vatLabel}: ${formatCurrency(vm.totals.vat)}`, enc));
  parts.push(line(`Discount: ${formatCurrency(vm.totals.discount)}`, enc));
  parts.push(cmd(ESC, 0x45, 1));
  parts.push(line(`TOTAL: ${formatCurrency(vm.totals.total)}`, enc));
  parts.push(cmd(ESC, 0x45, 0));
  parts.push(line(`Payment: ${formatPaymentMethod(vm.payment.method)}`, enc));

  if (
    vm.payment.method.toUpperCase() === 'CASH' &&
    vm.payment.amountPaid != null &&
    vm.payment.amountPaid > 0
  ) {
    parts.push(line(`Paid: ${formatCurrency(vm.payment.amountPaid)}`, enc));
    parts.push(line(`Change: ${formatCurrency(vm.payment.change ?? 0)}`, enc));
  }

  parts.push(divider());
  parts.push(center('ZRA SMART INVOICE', enc));
  parts.push(divider());
  if (vm.fiscal.fiscalReceiptNo) {
    parts.push(line(`Fiscal Receipt: ${vm.fiscal.fiscalReceiptNo}`, enc));
  }
  if (vm.fiscal.sdcId) {
    parts.push(line(`SDC ID: ${vm.fiscal.sdcId}`, enc));
  }
  if (vm.fiscal.receiptSignature) {
    parts.push(line(`Signature: ${vm.fiscal.receiptSignature}`, enc));
  }
  if (vm.fiscal.qrPayload) {
    parts.push(center('Scan to verify on ZRA Smart Invoice', enc));
    parts.push(qrCode(vm.fiscal.qrPayload, enc));
  }

  parts.push(divider('-'));
  parts.push(line(`Customer: ${vm.customer.name}`, enc));
  for (const footerLine of vm.footer.lines) {
    parts.push(center(footerLine, enc));
  }
  if (vm.footer.showPoweredBy) {
    parts.push(center(vm.footer.poweredByLine, enc));
    parts.push(center(vm.footer.fiscalizedLine, enc));
  }

  parts.push(cmd(LF, LF, LF));
  parts.push(cmd(GS, 0x56, 0)); // partial cut

  return concat(...parts);
}
