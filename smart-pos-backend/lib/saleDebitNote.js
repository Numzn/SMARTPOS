/**
 * Debit note (adjustment invoice) creation and VSDC submission.
 * PENDING → VSDC debit note (rcptTyCd=D) → COMPLETED
 */

const prisma = require('./prisma');
const zraInvoice = require('../services/zraInvoice');
const { createSnapshotFromSource } = require('./receipt/snapshot');

const DebitNoteStatus = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
};

async function createDebitNote(originalSaleId, debitNoteData, userId, branchId = 'default') {
  const originalSale = await prisma.sale.findUnique({
    where: { id: originalSaleId },
    include: {
      items: { include: { product: true } }
    }
  });

  if (!originalSale) {
    throw new Error(`Original sale ${originalSaleId} not found`);
  }

  if (originalSale.status !== 'COMPLETED' || !originalSale.fiscalInvcNo) {
    throw new Error('Debit notes can only be created for completed fiscal sales');
  }

  const debitNote = await prisma.debitNote.create({
    data: {
      originalSaleId,
      userId,
      status: DebitNoteStatus.PENDING,
      reasonCode: debitNoteData.reasonCode || '01',
      reason: debitNoteData.reason,
      subtotal: debitNoteData.subtotal,
      tax: debitNoteData.tax ?? 0,
      discount: debitNoteData.discount ?? 0,
      total: debitNoteData.total,
      paymentMethod: debitNoteData.paymentMethod || 'CASH',
      items: {
        create: debitNoteData.items.map(item => ({
          productId: item.productId,
          saleItemId: item.saleItemId || null,
          quantity: item.quantity,
          price: item.price,
          total: item.total,
          pkg: item.pkg,
          qty: item.qty,
          prc: item.prc,
          splyAmt: item.splyAmt,
          taxblAmt: item.taxblAmt,
          taxAmt: item.taxAmt,
          totAmt: item.totAmt,
          itemClsCd: item.itemClsCd,
          taxType: item.taxType
        }))
      }
    },
    include: {
      items: { include: { product: true } },
      user: true,
      sale: true
    }
  });

  return debitNote;
}

async function submitDebitNoteForFiscal(debitNoteId) {
  const debitNote = await prisma.debitNote.findUnique({
    where: { id: debitNoteId },
    include: {
      items: { include: { product: true } },
      sale: true,
      user: true
    }
  });

  if (!debitNote) {
    throw new Error(`Debit note ${debitNoteId} not found`);
  }

  if (debitNote.status !== 'PENDING') {
    throw new Error(`Debit note is ${debitNote.status}, only PENDING notes can be submitted`);
  }

  const invoiceService = new zraInvoice.ZRAInvoiceService({
    tpin: process.env.BUSINESS_TPIN,
    bhfId: process.env.BRANCH_ID || '000',
    sdcId: process.env.SDC_ID,
    deviceSn: process.env.DEVICE_SERIAL
  });

  const vsdcPayload = {
    receiptType: 'DEBIT_NOTE',
    items: debitNote.items,
    totals: {
      subtotal: debitNote.subtotal,
      tax: debitNote.tax,
      discount: debitNote.discount,
      total: debitNote.total
    },
    originalInvoiceNo: debitNote.sale.fiscalInvcNo,
    reasonCode: debitNote.reasonCode,
    reason: debitNote.reason
  };

  try {
    const result = await invoiceService.submitDebitNote(vsdcPayload);

    if (result.resultCd === '000') {
      await completeDebitNoteAfterFiscalSuccess(debitNoteId, result, vsdcPayload);
      return result;
    } else {
      throw new Error(`VSDC rejected debit note: ${result.resultMsg} (${result.resultCd})`);
    }
  } catch (error) {
    await prisma.debitNote.update({
      where: { id: debitNoteId },
      data: {
        status: DebitNoteStatus.FAILED,
        fiscalError: error.message,
        fiscalErrorCode: error.code
      }
    });
    throw error;
  }
}

async function completeDebitNoteAfterFiscalSuccess(debitNoteId, zra, fiscalPayload = {}) {
  const debitNote = await prisma.debitNote.update({
    where: { id: debitNoteId },
    data: {
      status: DebitNoteStatus.COMPLETED,
      rcptNo: zra.rcptNo,
      rcptSign: zra.rcptSign ?? null,
      intrlData: zra.intrlData ?? null,
      qrCode: zra.qrCode,
      vsdcTimestamp: new Date(),
      vsdcRequest: fiscalPayload.vsdcRequest ?? undefined,
      vsdcResponse: fiscalPayload.vsdcResponse ?? undefined,
      fiscalError: null,
      fiscalErrorCode: null
    },
    include: {
      items: { include: { product: true } },
      user: true,
      sale: true
    }
  });

  // Create receipt snapshot for printing
  await createSnapshotFromSource('DEBIT_NOTE', debitNoteId);

  return debitNote;
}

module.exports = {
  DebitNoteStatus,
  createDebitNote,
  submitDebitNoteForFiscal,
  completeDebitNoteAfterFiscalSuccess
};
