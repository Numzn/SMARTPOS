import { formatCurrency } from './formatCurrency';
import type { ReceiptViewModel } from './types';

export function copyLabel(vm: ReceiptViewModel): string | null {
  if (!vm.receiptMeta.isCopy) return null;
  const n = vm.receiptMeta.reprintCount;
  return n > 1 ? `COPY #${n}` : 'COPY';
}

export function receiptTitle(vm: ReceiptViewModel): string {
  if (vm.receiptMeta.receiptType === 'CREDIT_NOTE') return 'CREDIT NOTE';
  return 'TAX INVOICE';
}

export function formatPaymentMethod(method: string): string {
  const map: Record<string, string> = {
    CASH: 'CASH',
    CARD: 'CARD',
    MOBILE: 'MOBILE MONEY',
    BANK: 'BANK TRANSFER',
    CREDIT: 'CREDIT',
  };
  return map[method.toUpperCase()] ?? method;
}

export function lineItemColumns(vm: ReceiptViewModel) {
  return vm.items.map((item) => ({
    name: item.name,
    qty: String(item.qty),
    price: formatCurrency(item.unitPrice),
    total: formatCurrency(item.lineTotal),
  }));
}
