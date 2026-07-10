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

function line(text: string, enc: { encode(s: string): Uint8Array }): Uint8Array {
  return concat(enc.encode(text), cmd(LF));
}

function divider(char = '=', width = 42): Uint8Array {
  return line(char.repeat(width), textEncoder());
}

function center(text: string, enc: { encode(s: string): Uint8Array }): Uint8Array {
  return concat(cmd(ESC, 0x61, 1), line(text, enc), cmd(ESC, 0x61, 0));
}

/** Build ESC/POS command buffer for 80mm thermal printers from ReceiptViewModel. */
export function buildEscPosCommands(viewModel: ReceiptViewModel): Uint8Array {
  const vm = viewModel;
  const enc = textEncoder();
  const parts: Uint8Array[] = [];

  parts.push(cmd(ESC, 0x40)); // init

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
    parts.push(line('Scan QR on screen to verify', enc));
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
