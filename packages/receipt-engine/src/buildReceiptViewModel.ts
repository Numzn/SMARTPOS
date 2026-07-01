import { formatReceiptDate, formatReceiptTime, formatInvoiceNo } from './formatDate';
import type { ReceiptSourceData, ReceiptViewModel } from './types';

const WALK_IN_NAME = 'WALK-IN CUSTOMER';

function normalizeCustomer(source: ReceiptSourceData) {
  const rawName = source.customer?.name?.trim();
  const tpin = source.customer?.tpin?.trim() || null;
  const isB2B = Boolean(tpin && tpin !== '0000000000');
  const name = rawName || (isB2B ? 'Customer' : WALK_IN_NAME);
  return {
    name: name.toUpperCase() === 'WALK-IN CUSTOMER' ? WALK_IN_NAME : name,
    tpin,
    showTpin: isB2B,
  };
}

function mapSubmissionTime(value?: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function buildReceiptViewModel(source: ReceiptSourceData): ReceiptViewModel {
  const occurredAt = source.transaction.occurredAt;
  const vatRate = source.totals.vatRate ?? 16;
  const customer = normalizeCustomer(source);
  const version = source.footer?.receiptVersion ?? '1.0';

  return {
    merchant: {
      brand: source.merchant.brand ?? 'NUMZPAY',
      logoUrl: source.merchant.logoUrl ?? null,
      tradingName: source.merchant.tradingName,
      tpin: source.merchant.tpin,
      branchName: source.merchant.branchName,
      address: source.merchant.address,
      phone: source.merchant.phone ?? null,
    },
    transaction: {
      date: formatReceiptDate(occurredAt),
      time: formatReceiptTime(occurredAt),
      cashier: source.transaction.cashier,
      receiptNo: source.transaction.receiptNo,
      invoiceNo: formatInvoiceNo(source.transaction.fiscalInvoiceNo),
      itemCount: source.transaction.itemCount,
    },
    items: source.items,
    totals: {
      subtotal: source.totals.subtotal,
      vat: source.totals.vat,
      vatLabel: `VAT (${vatRate}%)`,
      discount: source.totals.discount,
      total: source.totals.total,
    },
    payment: {
      method: source.payment.method,
      amountPaid: source.payment.amountPaid ?? null,
      change: source.payment.change ?? null,
    },
    fiscal: {
      mode: source.fiscal.mode ?? 'ONLINE',
      submissionStatus: source.fiscal.submissionStatus,
      submissionTime: mapSubmissionTime(source.fiscal.submissionTime),
      sdcId: source.fiscal.sdcId ?? null,
      fiscalReceiptNo: source.fiscal.fiscalReceiptNo ?? source.transaction.receiptNo,
      receiptSignature: source.fiscal.receiptSignature ?? null,
      verificationCode: source.fiscal.verificationCode ?? null,
      qrPayload: source.fiscal.qrPayload ?? null,
      fiscalInvoiceNo: formatInvoiceNo(source.transaction.fiscalInvoiceNo),
    },
    customer,
    footer: {
      lines: source.footer?.lines ?? ['Thank you for shopping!'],
      showPoweredBy: source.footer?.showPoweredBy ?? true,
      poweredByLine: 'Powered by NUMZPAY',
      fiscalizedLine: 'Fiscalized via ZRA Smart Invoice',
    },
    receiptMeta: {
      receiptType: source.receiptType,
      originalReceiptNo: source.originalReceiptNo ?? source.receiptMeta?.originalReceiptNo ?? null,
      isCopy: source.receiptMeta?.isCopy ?? false,
      printedAt: source.receiptMeta?.printedAt ?? null,
      printedBy: source.receiptMeta?.printedBy ?? null,
      reprintCount: source.receiptMeta?.reprintCount ?? 0,
      version: source.receiptMeta?.version ?? version,
    },
  };
}
