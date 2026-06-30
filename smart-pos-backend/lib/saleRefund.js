/**
 * Fiscal refund / credit note lifecycle (VSDC Section 5.1).
 * PENDING → VSDC credit note (rcptTyCd=R) → COMPLETED + stock restore.
 */

const prisma = require('./prisma');
const { restoreStockForRefund, DEFAULT_BRANCH } = require('./inventoryStock');
const zraInvoiceService = require('../services/zraInvoice');
const vsdcService = require('../services/vsdcService');

const refundInclude = {
  user: { select: { id: true, name: true, email: true } },
  refundItems: { include: { product: true } },
  originalSale: {
    include: {
      saleItems: { include: { product: true } },
    },
  },
};

function getOriginalInvcNo(sale) {
  const resp = sale?.vsdcResponse;
  if (resp && typeof resp === 'object') {
    return resp.invcNo || resp.data?.invcNo || 0;
  }
  return 0;
}

async function getRefundedQtyBySaleItem(originalSaleId) {
  const prior = await prisma.refundItem.findMany({
    where: {
      refund: { originalSaleId, status: 'COMPLETED' },
    },
    select: { saleItemId: true, quantity: true },
  });

  const map = new Map();
  for (const row of prior) {
    if (!row.saleItemId) continue;
    map.set(row.saleItemId, (map.get(row.saleItemId) || 0) + row.quantity);
  }
  return map;
}

function resolveRefundLines(originalSale, bodyItems, refundedQtyMap) {
  const lines = [];

  if (Array.isArray(bodyItems) && bodyItems.length > 0) {
    for (const req of bodyItems) {
      const saleItem = originalSale.saleItems.find((s) => s.id === req.saleItemId);
      if (!saleItem) {
        const err = new Error(`Sale line not found: ${req.saleItemId}`);
        err.status = 400;
        throw err;
      }
      const qty = parseInt(req.quantity, 10);
      if (!qty || qty < 1) {
        const err = new Error(`Invalid refund quantity for line ${req.saleItemId}`);
        err.status = 400;
        throw err;
      }
      const already = refundedQtyMap.get(saleItem.id) || 0;
      const remaining = saleItem.quantity - already;
      if (qty > remaining) {
        const err = new Error(
          `Cannot refund ${qty} of ${saleItem.product?.sku || saleItem.productId}: only ${remaining} remaining`
        );
        err.status = 409;
        throw err;
      }
      lines.push({ saleItem, quantity: qty });
    }
    return lines;
  }

  for (const saleItem of originalSale.saleItems) {
    const already = refundedQtyMap.get(saleItem.id) || 0;
    const remaining = saleItem.quantity - already;
    if (remaining > 0) {
      lines.push({ saleItem, quantity: remaining });
    }
  }

  if (lines.length === 0) {
    const err = new Error('Nothing left to refund on this sale');
    err.status = 409;
    throw err;
  }

  return lines;
}

async function createPendingRefund(originalSaleId, body) {
  const { userId, reasonCode = '01', reason, items: bodyItems } = body;

  if (!userId) {
    const err = new Error('userId is required');
    err.status = 400;
    throw err;
  }

  const originalSale = await prisma.sale.findUnique({
    where: { id: originalSaleId },
    include: { saleItems: { include: { product: true } } },
  });

  if (!originalSale) {
    const err = new Error('Original sale not found');
    err.status = 404;
    throw err;
  }

  if (originalSale.status !== 'COMPLETED' || !originalSale.rcptNo) {
    const err = new Error('Only completed fiscal sales can be refunded');
    err.status = 400;
    throw err;
  }

  if (originalSale.status === 'REFUNDED') {
    const err = new Error('Sale is already fully refunded');
    err.status = 409;
    throw err;
  }

  const refundedQtyMap = await getRefundedQtyBySaleItem(originalSaleId);
  const lines = resolveRefundLines(originalSale, bodyItems, refundedQtyMap);

  let subtotal = 0;
  let taxTotal = 0;

  const refundItemRows = lines.map(({ saleItem, quantity }) => {
    const unitPrice = saleItem.price;
    const itemTotal = quantity * unitPrice;
    const taxRate = (saleItem.product?.taxRate ?? 16) / 100;
    const splyAmt = itemTotal;
    const taxblAmt = splyAmt;
    const taxAmt = taxblAmt * taxRate;
    const totAmt = splyAmt + taxAmt;

    subtotal += itemTotal;
    taxTotal += taxAmt;

    return {
      saleItemId: saleItem.id,
      productId: saleItem.productId,
      quantity,
      price: unitPrice,
      total: itemTotal,
      pkg: saleItem.pkg ?? 1,
      qty: quantity,
      prc: unitPrice,
      splyAmt,
      taxblAmt,
      taxAmt,
      totAmt,
    };
  });

  const total = subtotal + taxTotal - (originalSale.discount || 0);

  return prisma.refund.create({
    data: {
      originalSaleId,
      userId,
      status: 'PENDING',
      reasonCode,
      reason: reason || null,
      subtotal,
      tax: taxTotal,
      discount: originalSale.discount || 0,
      total,
      paymentMethod: originalSale.paymentMethod,
      refundItems: { create: refundItemRows },
    },
    include: refundInclude,
  });
}

async function restoreStockForRefundRecord(refund, branchId = DEFAULT_BRANCH) {
  await prisma.$transaction(async (tx) => {
    for (const item of refund.refundItems) {
      await restoreStockForRefund(tx, {
        productId: item.productId,
        quantity: item.quantity,
        branchId,
        userId: refund.userId,
        refundId: refund.id,
      });
    }
  });
}

async function markSaleRefundedIfFully(originalSaleId) {
  const sale = await prisma.sale.findUnique({
    where: { id: originalSaleId },
    include: { saleItems: true },
  });
  if (!sale) return;

  const refundedQtyMap = await getRefundedQtyBySaleItem(originalSaleId);
  const fullyRefunded = sale.saleItems.every((line) => {
    const refunded = refundedQtyMap.get(line.id) || 0;
    return refunded >= line.quantity;
  });

  if (fullyRefunded) {
    await prisma.sale.update({
      where: { id: originalSaleId },
      data: { status: 'REFUNDED' },
    });
  }
}

async function finalizeRefundFiscally(refundId, { branchId = DEFAULT_BRANCH } = {}) {
  const ready = await vsdcService.isDeviceReady();
  if (!ready) {
    const init = await vsdcService.ensureDeviceInitialized();
    if (!init.success) {
      const err = new Error(init.error || 'VSDC device not initialized');
      err.status = 503;
      throw err;
    }
  }

  let refund = await prisma.refund.findUnique({
    where: { id: refundId },
    include: refundInclude,
  });

  if (!refund) {
    const err = new Error('Refund not found');
    err.status = 404;
    throw err;
  }

  if (refund.status === 'COMPLETED' && refund.rcptNo) {
    return {
      success: true,
      refund,
      fiscal: { success: true, rcptNo: refund.rcptNo, qrCode: refund.qrCode },
    };
  }

  if (!['PENDING', 'FISCAL_FAILED', 'FISCAL_SUBMITTING'].includes(refund.status)) {
    const err = new Error(`Refund cannot be fiscalized in status ${refund.status}`);
    err.status = 400;
    throw err;
  }

  await prisma.refund.update({
    where: { id: refundId },
    data: { status: 'FISCAL_SUBMITTING', fiscalError: null },
  });

  const fiscalResult = await zraInvoiceService.submitFiscalForRefund(refundId);

  if (!fiscalResult.success) {
    const failed = await prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'FISCAL_FAILED',
        fiscalError: fiscalResult.message || fiscalResult.error || 'ZRA credit note failed',
        vsdcRequest: fiscalResult.vsdcRequest ?? undefined,
        vsdcResponse: fiscalResult.vsdcResponse ?? undefined,
      },
      include: refundInclude,
    });

    return {
      success: false,
      refund: failed,
      fiscal: { success: false, error: failed.fiscalError },
    };
  }

  const zra = fiscalResult.zraResponse;
  refund = await prisma.refund.update({
    where: { id: refundId },
    data: {
      status: 'COMPLETED',
      rcptNo: zra.rcptNo,
      rcptSign: zra.intrlData || zra.rcptSign,
      qrCode: zra.qrCode,
      vsdcTimestamp: new Date(),
      vsdcRequest: fiscalResult.vsdcRequest ?? undefined,
      vsdcResponse: fiscalResult.vsdcResponse ?? undefined,
      fiscalError: null,
    },
    include: refundInclude,
  });

  await restoreStockForRefundRecord(refund, branchId);

  const stockSyncService = require('../services/stockSyncService');
  stockSyncService.syncRecentMovements({ referenceId: refund.id, branchId }).catch((err) => {
    console.warn('[saleRefund] post-refund stock sync failed:', err.message);
  });

  await markSaleRefundedIfFully(refund.originalSaleId);

  return {
    success: true,
    refund,
    fiscal: {
      success: true,
      rcptNo: refund.rcptNo,
      qrCode: refund.qrCode,
      receiptNumber: refund.rcptNo,
      originalInvcNo: getOriginalInvcNo(refund.originalSale),
    },
  };
}

async function refundSale(originalSaleId, body) {
  const branchId = body.branchId || DEFAULT_BRANCH;
  const pending = await createPendingRefund(originalSaleId, body);
  return finalizeRefundFiscally(pending.id, { branchId });
}

module.exports = {
  refundInclude,
  getOriginalInvcNo,
  createPendingRefund,
  finalizeRefundFiscally,
  refundSale,
  restoreStockForRefundRecord,
};
