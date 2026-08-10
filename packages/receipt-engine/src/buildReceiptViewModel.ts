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
    address: source.customer?.address?.trim() || null,
  };
}

function mapSubmissionTime(value?: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Real per-rate VAT — no hardcoded fallback. A rate is only known two ways:
 * an explicit per-line breakdown (preferred, handles mixed-rate baskets), or
 * a single blended rate derived from vat/subtotal (falls back to 0 only when
 * there's nothing to derive from, e.g. a zero-value sale — never defaults to
 * 16% for an exempt/zero-rated line, which is the bug this replaces).
 */
function resolveVatBreakdown(source: ReceiptSourceData) {
  const raw = source.totals.vatBreakdown;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((entry) => ({
      rate: entry.rate,
      taxable: entry.taxable,
      vat: entry.vat,
      label: `VAT (${entry.rate}%)`,
    }));
  }

  const { subtotal, vat, vatRate } = source.totals;
  const rate = vatRate ?? (subtotal > 0 ? Math.round((vat / subtotal) * 10000) / 100 : 0);
  return [{ rate, taxable: subtotal, vat, label: `VAT (${rate}%)` }];
}

function resolveDiscountRate(source: ReceiptSourceData): number {
  if (source.totals.discountRate != null) return source.totals.discountRate;
  const { subtotal, discount } = source.totals;
  if (!discount || subtotal <= 0) return 0;
  return Math.round((discount / subtotal) * 10000) / 100;
}

export function buildReceiptViewModel(source: ReceiptSourceData): ReceiptViewModel {
  const occurredAt = source.transaction.occurredAt;
  const vatBreakdown = resolveVatBreakdown(source);
  const vatLabel =
    vatBreakdown.length === 1 ? vatBreakdown[0].label : 'VAT';
  const discountRate = resolveDiscountRate(source);
  const discountLabel = discountRate > 0 ? `Discount (${discountRate}%)` : 'Discount';
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
      vatLabel,
      vatBreakdown,
      discount: source.totals.discount,
      discountRate,
      discountLabel,
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
      internalData: source.fiscal.internalData ?? null,
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
