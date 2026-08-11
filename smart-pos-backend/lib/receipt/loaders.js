/**
 * Map Prisma sale/refund records to ReceiptSourceData for @smartpos/receipt-engine.
 */

const { getBusinessProfile } = require('../ensureBusinessProfile');

function extractVsdcField(vsdcResponse, ...keys) {
  if (!vsdcResponse || typeof vsdcResponse !== 'object') return null;
  const data =
    vsdcResponse.data && typeof vsdcResponse.data === 'object' ? vsdcResponse.data : vsdcResponse;
  for (const key of keys) {
    if (data[key] != null && data[key] !== '') return String(data[key]);
  }
  return null;
}

function mapSubmissionStatus(status) {
  if (status === 'COMPLETED') return 'SUBMITTED';
  if (status === 'FISCAL_FAILED') return 'FAILED';
  return 'PENDING';
}

function formatPaymentLabel(method) {
  const map = {
    CASH: 'CASH',
    CARD: 'CARD',
    DIGITAL_WALLET: 'MOBILE MONEY',
    BANK_TRANSFER: 'BANK TRANSFER',
  };
  return map[method] || method;
}

function mapSaleItems(saleItems) {
  return saleItems.map((line) => ({
    name: line.product?.name || 'Item',
    qty: line.quantity,
    unitPrice: line.price,
    lineTotal: line.total,
  }));
}

function sumItemQty(items) {
  return items.reduce((s, i) => s + (i.qty || 0), 0);
}

/**
 * Group raw line rows (SaleItem/RefundItem, each carrying taxblAmt/taxAmt) by
 * their effective VAT rate — real per-line data, not an assumed flat rate.
 * Rows with no taxable amount (free/zero-value lines) are dropped from the
 * breakdown rather than distorting the rate with a divide-by-zero.
 */
function computeVatBreakdown(lines) {
  const byRate = new Map();
  for (const line of lines) {
    const taxblAmt = Number(line.taxblAmt) || 0;
    const taxAmt = Number(line.taxAmt) || 0;
    if (taxblAmt <= 0) continue;
    const rate = Math.round((taxAmt / taxblAmt) * 10000) / 100;
    const existing = byRate.get(rate) || { rate, taxable: 0, vat: 0 };
    existing.taxable += taxblAmt;
    existing.vat += taxAmt;
    byRate.set(rate, existing);
  }
  return Array.from(byRate.values()).sort((a, b) => a.rate - b.rate);
}

function computeDiscountRate(discount, subtotal) {
  if (!discount || subtotal <= 0) return 0;
  return Math.round((discount / subtotal) * 10000) / 100;
}

async function loadBusinessContext() {
  return getBusinessProfile();
}

async function buildSaleReceiptSource(sale, business) {
  const branch = sale.branch || {};
  const vsdc = sale.vsdcResponse;

  return {
    receiptType: 'SALE',
    merchant: {
      brand: 'NUMZPAY',
      logoUrl: business.logoUrl,
      tradingName: business.tradingName,
      tpin: business.tpin,
      branchName: branch.name || sale.branchId || 'main',
      address: branch.address || '',
      phone: branch.phone || null,
    },
    transaction: {
      occurredAt: sale.createdAt,
      cashier: sale.user?.name || sale.user?.email || 'Cashier',
      receiptNo: sale.rcptNo,
      fiscalInvoiceNo: sale.fiscalInvcNo,
      itemCount: sumItemQty(mapSaleItems(sale.saleItems)),
    },
    items: mapSaleItems(sale.saleItems),
    totals: {
      subtotal: sale.subtotal,
      vat: sale.tax ?? 0,
      vatBreakdown: computeVatBreakdown(sale.saleItems),
      discount: sale.discount ?? 0,
      discountRate: computeDiscountRate(sale.discount ?? 0, sale.subtotal),
      total: sale.total,
    },
    payment: {
      method: formatPaymentLabel(sale.paymentMethod),
      amountPaid: sale.amountPaid,
      change: sale.changeAmount,
    },
    fiscal: {
      mode: 'ONLINE',
      submissionStatus: mapSubmissionStatus(sale.status),
      submissionTime: sale.vsdcTimestamp,
      sdcId: extractVsdcField(vsdc, 'sdcId', 'sdicId', 'zraSdcId'),
      fiscalReceiptNo: sale.rcptNo,
      receiptSignature: sale.rcptSign,
      internalData: sale.intrlData,
      verificationCode: extractVsdcField(vsdc, 'verificationCode', 'vfnCode'),
      qrPayload: sale.qrCode,
    },
    customer: {
      name: sale.customerName,
      tpin: sale.customerTpin,
      address: sale.customer?.address || null,
    },
    footer: {
      lines: Array.isArray(business.footerLines) ? business.footerLines : [],
      showPoweredBy: business.showPoweredBy,
      receiptVersion: business.receiptVersion,
    },
  };
}

async function buildRefundReceiptSource(refund, business) {
  const original = refund.originalSale || {};
  const branch = original.branch || {};
  const vsdc = refund.vsdcResponse;

  return {
    receiptType: 'CREDIT_NOTE',
    originalReceiptNo: original.rcptNo || null,
    merchant: {
      brand: 'NUMZPAY',
      logoUrl: business.logoUrl,
      tradingName: business.tradingName,
      tpin: business.tpin,
      branchName: branch.name || original.branchId || 'main',
      address: branch.address || '',
      phone: branch.phone || null,
    },
    transaction: {
      occurredAt: refund.createdAt,
      cashier: refund.user?.name || refund.user?.email || 'Cashier',
      receiptNo: refund.rcptNo,
      fiscalInvoiceNo: refund.fiscalInvcNo,
      itemCount: sumItemQty(mapSaleItems(refund.refundItems)),
    },
    items: refund.refundItems.map((line) => ({
      name: line.product?.name || 'Item',
      qty: line.quantity,
      unitPrice: line.price,
      lineTotal: line.total,
    })),
    totals: {
      subtotal: refund.subtotal,
      vat: refund.tax ?? 0,
      vatBreakdown: computeVatBreakdown(refund.refundItems),
      discount: refund.discount ?? 0,
      discountRate: computeDiscountRate(refund.discount ?? 0, refund.subtotal),
      total: refund.total,
    },
    payment: {
      method: formatPaymentLabel(refund.paymentMethod),
      amountPaid: null,
      change: null,
    },
    fiscal: {
      mode: 'ONLINE',
      submissionStatus: mapSubmissionStatus(refund.status),
      submissionTime: refund.vsdcTimestamp,
      sdcId: extractVsdcField(vsdc, 'sdcId', 'sdicId', 'zraSdcId'),
      fiscalReceiptNo: refund.rcptNo,
      receiptSignature: refund.rcptSign,
      internalData: refund.intrlData,
      verificationCode: extractVsdcField(vsdc, 'verificationCode', 'vfnCode'),
      qrPayload: refund.qrCode,
    },
    customer: {
      name: original.customerName,
      tpin: original.customerTpin,
      address: original.customer?.address || null,
    },
    footer: {
      lines: Array.isArray(business.footerLines) ? business.footerLines : [],
      showPoweredBy: business.showPoweredBy,
      receiptVersion: business.receiptVersion,
    },
  };
}

async function buildDebitNoteReceiptSource(debitNote, business) {
  const original = debitNote.sale || {};
  const branch = original.branch || {};
  const vsdc = debitNote.vsdcResponse;

  return {
    receiptType: 'DEBIT_NOTE',
    originalReceiptNo: original.rcptNo || null,
    merchant: {
      brand: 'NUMZPAY',
      logoUrl: business.logoUrl,
      tradingName: business.tradingName,
      tpin: business.tpin,
      branchName: branch.name || original.branchId || 'main',
      address: branch.address || '',
      phone: branch.phone || null,
    },
    transaction: {
      occurredAt: debitNote.createdAt,
      cashier: debitNote.user?.name || debitNote.user?.email || 'Cashier',
      receiptNo: debitNote.rcptNo,
      fiscalInvoiceNo: debitNote.fiscalInvcNo,
      itemCount: sumItemQty(mapSaleItems(debitNote.items)),
    },
    items: debitNote.items.map((line) => ({
      name: line.product?.name || 'Item',
      qty: line.quantity,
      unitPrice: line.price,
      lineTotal: line.total,
    })),
    totals: {
      subtotal: debitNote.subtotal,
      vat: debitNote.tax ?? 0,
      vatBreakdown: computeVatBreakdown(debitNote.items),
      discount: debitNote.discount ?? 0,
      discountRate: computeDiscountRate(debitNote.discount ?? 0, debitNote.subtotal),
      total: debitNote.total,
    },
    payment: {
      method: formatPaymentLabel(debitNote.paymentMethod),
      amountPaid: null,
      change: null,
    },
    fiscal: {
      mode: 'ONLINE',
      submissionStatus: mapSubmissionStatus(debitNote.status),
      submissionTime: debitNote.vsdcTimestamp,
      sdcId: extractVsdcField(vsdc, 'sdcId', 'sdicId', 'zraSdcId'),
      fiscalReceiptNo: debitNote.rcptNo,
      receiptSignature: debitNote.rcptSign,
      internalData: debitNote.intrlData,
      verificationCode: extractVsdcField(vsdc, 'verificationCode', 'vfnCode'),
      qrPayload: debitNote.qrCode,
    },
    customer: {
      name: original.customerName,
      tpin: original.customerTpin,
      address: original.customer?.address || null,
    },
    footer: {
      lines: Array.isArray(business.footerLines) ? business.footerLines : [],
      showPoweredBy: business.showPoweredBy,
      receiptVersion: business.receiptVersion,
    },
  };
}

module.exports = {
  buildSaleReceiptSource,
  buildRefundReceiptSource,
  buildDebitNoteReceiptSource,
  loadBusinessContext,
  extractVsdcField,
};
