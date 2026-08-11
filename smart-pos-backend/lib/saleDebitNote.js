/**
 * Fiscal debit note lifecycle (VSDC Section 5.1, rcptTyCd='D').
 * PENDING → VSDC debit note → COMPLETED. Value-adjustment only — unlike a
 * refund, a debit note does not move stock (see lib/saleRefund.js for the
 * mirror-image credit-note flow, which does restore stock).
 */

const prisma = require('./prisma');
const zraInvoiceService = require('../services/zraInvoice');
const vsdcService = require('../services/vsdcService');

const debitNoteInclude = {
  user: { select: { id: true, name: true, email: true } },
  items: { include: { product: true } },
  sale: {
    include: {
      saleItems: { include: { product: true } },
      customer: true,
    },
  },
};

function parseVsdcDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function createPendingDebitNote(originalSaleId, body) {
  const { userId, reasonCode = '01', reason, items: bodyItems } = body;

  if (!userId) {
    const err = new Error('userId is required');
    err.status = 400;
    throw err;
  }

  if (!Array.isArray(bodyItems) || bodyItems.length === 0) {
    const err = new Error('At least one adjustment line is required');
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
    const err = new Error('Only completed fiscal sales can carry a debit note');
    err.status = 400;
    throw err;
  }

  let subtotal = 0;
  let taxTotal = 0;

  const itemRows = bodyItems.map((line) => {
    const saleItem = line.saleItemId
      ? originalSale.saleItems.find((s) => s.id === line.saleItemId)
      : null;

    if (line.saleItemId && !saleItem) {
      const err = new Error(`Sale line not found: ${line.saleItemId}`);
      err.status = 400;
      throw err;
    }

    const productId = line.productId || saleItem?.productId;
    if (!productId) {
      const err = new Error('productId (or a valid saleItemId) is required for each adjustment line');
      err.status = 400;
      throw err;
    }

    const quantity = parseInt(line.quantity, 10);
    if (!quantity || quantity < 1) {
      const err = new Error('Invalid adjustment quantity');
      err.status = 400;
      throw err;
    }

    const unitPrice = Number(line.price ?? saleItem?.price ?? 0);
    const itemTotal = quantity * unitPrice;
    const taxRate = (saleItem?.product?.taxRate ?? line.taxRate ?? 16) / 100;
    const splyAmt = itemTotal;
    const taxblAmt = splyAmt;
    const taxAmt = taxblAmt * taxRate;
    const totAmt = splyAmt + taxAmt;

    subtotal += itemTotal;
    taxTotal += taxAmt;

    return {
      saleItemId: saleItem?.id ?? null,
      productId,
      quantity,
      price: unitPrice,
      total: itemTotal,
      pkg: saleItem?.pkg ?? 1,
      qty: quantity,
      prc: unitPrice,
      splyAmt,
      taxblAmt,
      taxAmt,
      totAmt,
      // Carry forward the sale line's classification snapshot, same rationale
      // as lib/saleRefund.js — a debit note must match what was originally
      // sold, not what the product looks like today.
      itemClsCd: saleItem?.itemClsCd ?? null,
      taxType: saleItem?.taxType ?? null,
    };
  });

  const total = subtotal + taxTotal;

  return prisma.debitNote.create({
    data: {
      originalSaleId,
      userId,
      status: 'PENDING',
      reasonCode,
      reason: reason || null,
      subtotal,
      tax: taxTotal,
      discount: 0,
      total,
      paymentMethod: originalSale.paymentMethod,
      items: { create: itemRows },
    },
    include: debitNoteInclude,
  });
}

/**
 * Complete a debit note after confirmed VSDC success. No stock movement —
 * unlike completeRefundAfterFiscalSuccess, a debit note is a pure value
 * adjustment against an already-fulfilled sale.
 */
async function completeDebitNoteAfterFiscalSuccess(debitNoteId, zra, fiscalPayload = {}) {
  const debitNote = await prisma.debitNote.update({
    where: { id: debitNoteId },
    data: {
      status: 'COMPLETED',
      rcptNo: zra.rcptNo,
      rcptSign: zra.rcptSign ?? null,
      intrlData: zra.intrlData ?? null,
      qrCode: zra.qrCode,
      vsdcTimestamp: new Date(),
      vsdcRcptPbctDate: parseVsdcDate(zra.vsdcRcptPbctDate),
      vsdcRequest: fiscalPayload.vsdcRequest ?? undefined,
      vsdcResponse: fiscalPayload.vsdcResponse ?? undefined,
      fiscalError: null,
      fiscalErrorCode: null,
    },
    include: debitNoteInclude,
  });

  try {
    const { createSnapshotFromSource } = require('./receipt/snapshot');
    await createSnapshotFromSource('DEBIT_NOTE', debitNoteId);
  } catch (snapErr) {
    console.warn('[saleDebitNote] receipt snapshot failed:', snapErr.message);
  }

  return debitNote;
}

async function finalizeDebitNoteFiscally(debitNoteId) {
  const ready = await vsdcService.isDeviceReady();
  if (!ready) {
    const init = await vsdcService.ensureDeviceInitialized();
    if (!init.success) {
      const err = new Error(init.error || 'VSDC device not initialized');
      err.status = 503;
      throw err;
    }
  }

  let debitNote = await prisma.debitNote.findUnique({
    where: { id: debitNoteId },
    include: debitNoteInclude,
  });

  if (!debitNote) {
    const err = new Error('Debit note not found');
    err.status = 404;
    throw err;
  }

  if (debitNote.status === 'COMPLETED' && debitNote.rcptNo) {
    return {
      success: true,
      debitNote,
      fiscal: { success: true, rcptNo: debitNote.rcptNo, qrCode: debitNote.qrCode },
    };
  }

  if (!['PENDING', 'FISCAL_FAILED', 'FISCAL_SUBMITTING'].includes(debitNote.status)) {
    const err = new Error(`Debit note cannot be fiscalized in status ${debitNote.status}`);
    err.status = 400;
    throw err;
  }

  await prisma.debitNote.update({
    where: { id: debitNoteId },
    data: { status: 'FISCAL_SUBMITTING', fiscalError: null },
  });

  const fiscalResult = await zraInvoiceService.submitFiscalForDebitNote(debitNoteId);

  if (!fiscalResult.success) {
    const failed = await prisma.debitNote.update({
      where: { id: debitNoteId },
      data: {
        status: 'FISCAL_FAILED',
        fiscalError: fiscalResult.message || fiscalResult.error || 'ZRA debit note failed',
        fiscalErrorCode: fiscalResult.code || null,
        vsdcRequest: fiscalResult.vsdcRequest ?? undefined,
        vsdcResponse: fiscalResult.vsdcResponse ?? undefined,
      },
      include: debitNoteInclude,
    });

    return {
      success: false,
      debitNote: failed,
      fiscal: { success: false, error: failed.fiscalError, code: failed.fiscalErrorCode },
    };
  }

  const zra = fiscalResult.zraResponse;
  debitNote = await completeDebitNoteAfterFiscalSuccess(debitNoteId, zra, {
    vsdcRequest: fiscalResult.vsdcRequest,
    vsdcResponse: fiscalResult.vsdcResponse,
  });

  return {
    success: true,
    debitNote,
    fiscal: {
      success: true,
      rcptNo: debitNote.rcptNo,
      qrCode: debitNote.qrCode,
      receiptNumber: debitNote.rcptNo,
    },
  };
}

async function debitNoteSale(originalSaleId, body) {
  const pending = await createPendingDebitNote(originalSaleId, body);
  return finalizeDebitNoteFiscally(pending.id);
}

module.exports = {
  debitNoteInclude,
  createPendingDebitNote,
  finalizeDebitNoteFiscally,
  completeDebitNoteAfterFiscalSuccess,
  debitNoteSale,
};
