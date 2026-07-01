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
      discount: sale.discount ?? 0,
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
      verificationCode: extractVsdcField(vsdc, 'verificationCode', 'vfnCode'),
      qrPayload: sale.qrCode,
    },
    customer: {
      name: sale.customerName,
      tpin: sale.customerTpin,
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
      discount: refund.discount ?? 0,
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
      verificationCode: extractVsdcField(vsdc, 'verificationCode', 'vfnCode'),
      qrPayload: refund.qrCode,
    },
    customer: {
      name: original.customerName,
      tpin: original.customerTpin,
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
  loadBusinessContext,
  extractVsdcField,
};
