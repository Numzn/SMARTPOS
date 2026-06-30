/**
 * Reconcile sales/refunds stuck in FISCAL_SUBMITTING (orphan receipt recovery).
 */

const prisma = require('./prisma');
const vsdcService = require('../services/vsdcService');
const {
  completeSaleAfterFiscalSuccess,
  extractZraFromVsdcPayload,
  saleInclude,
  releaseStockReservationForSale,
} = require('./saleFiscal');
const { DEFAULT_BRANCH } = require('./inventoryStock');
const { refundInclude, restoreStockForRefundRecord } = require('./saleRefund');

const DEFAULT_WINDOW_MINUTES = 10;
const DEFAULT_BATCH_SIZE = 50;

function reconciliationCutoff(windowMinutes = DEFAULT_WINDOW_MINUTES) {
  return new Date(Date.now() - windowMinutes * 60 * 1000);
}

async function lookupZraForSale(sale) {
  const fromResponse = extractZraFromVsdcPayload(sale.vsdcResponse);
  if (fromResponse?.rcptNo) {
    return { zra: fromResponse, source: 'vsdcResponse' };
  }

  if (sale.fiscalInvcNo) {
    const lookup = await vsdcService.lookupInvoiceByInvcNo(sale.fiscalInvcNo);
    if (lookup.success) {
      const zra = extractZraFromVsdcPayload(lookup.data);
      if (zra?.rcptNo) {
        return { zra, source: 'vsdcLookup', vsdcResponse: lookup.data };
      }
    }
  }

  return null;
}

async function reconcileStuckSale(sale, { branchId = DEFAULT_BRANCH } = {}) {
  if (sale.rcptNo) {
    await completeSaleAfterFiscalSuccess(
      sale.id,
      {
        rcptNo: sale.rcptNo,
        qrCode: sale.qrCode,
        rcptSign: sale.rcptSign,
        intrlData: sale.rcptSign,
      },
      { vsdcRequest: sale.vsdcRequest, vsdcResponse: sale.vsdcResponse },
      branchId
    );
    return { saleId: sale.id, action: 'completed_existing_rcpt' };
  }

  const found = await lookupZraForSale(sale);
  if (found) {
    await completeSaleAfterFiscalSuccess(
      sale.id,
      found.zra,
      {
        vsdcRequest: sale.vsdcRequest,
        vsdcResponse: found.vsdcResponse || sale.vsdcResponse,
      },
      branchId
    );
    return { saleId: sale.id, action: `completed_from_${found.source}` };
  }

  await prisma.$transaction(async (tx) => {
    await releaseStockReservationForSale(tx, sale, branchId);
  });

  await prisma.sale.update({
    where: { id: sale.id },
    data: {
      status: 'FISCAL_FAILED',
      fiscalError: 'Fiscal reconciliation: no VSDC receipt found after submission timeout',
    },
  });

  return { saleId: sale.id, action: 'marked_failed_released_reservation' };
}

async function reconcileStuckRefund(refund, { branchId = DEFAULT_BRANCH } = {}) {
  if (refund.rcptNo) {
    const updated = await prisma.refund.update({
      where: { id: refund.id },
      data: { status: 'COMPLETED', fiscalError: null },
      include: refundInclude,
    });

    const existingMovement = await prisma.stockMovement.findFirst({
      where: {
        referenceType: 'REFUND',
        referenceId: refund.id,
        movementType: 'RETURN_IN',
      },
    });

    if (!existingMovement) {
      await restoreStockForRefundRecord(updated, branchId);
    }

    return { refundId: refund.id, action: 'completed_existing_rcpt' };
  }

  const fromResponse = extractZraFromVsdcPayload(refund.vsdcResponse);
  if (fromResponse?.rcptNo) {
    const zra = fromResponse;
    const updated = await prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: 'COMPLETED',
        rcptNo: zra.rcptNo,
        rcptSign: zra.intrlData || zra.rcptSign,
        qrCode: zra.qrCode,
        vsdcTimestamp: new Date(),
        fiscalError: null,
      },
      include: refundInclude,
    });

    const existingMovement = await prisma.stockMovement.findFirst({
      where: {
        referenceType: 'REFUND',
        referenceId: refund.id,
        movementType: 'RETURN_IN',
      },
    });

    if (!existingMovement) {
      const { restoreStockForRefundRecord } = require('./saleRefund');
      await restoreStockForRefundRecord(updated, branchId);
    }

    return { refundId: refund.id, action: 'completed_from_vsdcResponse' };
  }

  if (refund.fiscalInvcNo) {
    const lookup = await vsdcService.lookupInvoiceByInvcNo(refund.fiscalInvcNo);
    if (lookup.success) {
      const zra = extractZraFromVsdcPayload(lookup.data);
      if (zra?.rcptNo) {
        const updated = await prisma.refund.update({
          where: { id: refund.id },
          data: {
            status: 'COMPLETED',
            rcptNo: zra.rcptNo,
            rcptSign: zra.intrlData || zra.rcptSign,
            qrCode: zra.qrCode,
            vsdcTimestamp: new Date(),
            vsdcResponse: lookup.data,
            fiscalError: null,
          },
          include: refundInclude,
        });

        const existingMovement = await prisma.stockMovement.findFirst({
          where: {
            referenceType: 'REFUND',
            referenceId: refund.id,
            movementType: 'RETURN_IN',
          },
        });

        if (!existingMovement) {
          await restoreStockForRefundRecord(updated, branchId);
        }

        return { refundId: refund.id, action: 'completed_from_vsdcLookup' };
      }
    }
  }

  await prisma.refund.update({
    where: { id: refund.id },
    data: {
      status: 'FISCAL_FAILED',
      fiscalError: 'Fiscal reconciliation: no VSDC credit note found after submission timeout',
    },
  });

  return { refundId: refund.id, action: 'marked_failed' };
}

async function reconcileStuckFiscalRecords(options = {}) {
  const windowMinutes = options.windowMinutes ?? DEFAULT_WINDOW_MINUTES;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const branchId = options.branchId ?? DEFAULT_BRANCH;
  const cutoff = reconciliationCutoff(windowMinutes);

  const stuckSales = await prisma.sale.findMany({
    where: {
      status: 'FISCAL_SUBMITTING',
      updatedAt: { lt: cutoff },
    },
    include: saleInclude,
    take: batchSize,
    orderBy: { updatedAt: 'asc' },
  });

  const stuckRefunds = await prisma.refund.findMany({
    where: {
      status: 'FISCAL_SUBMITTING',
      updatedAt: { lt: cutoff },
    },
    include: refundInclude,
    take: batchSize,
    orderBy: { updatedAt: 'asc' },
  });

  const results = {
    salesChecked: stuckSales.length,
    refundsChecked: stuckRefunds.length,
    actions: [],
  };

  if (stuckSales.length === 0 && stuckRefunds.length === 0) {
    return results;
  }

  console.log(
    `[Fiscal Reconcile] ${stuckSales.length} sale(s), ${stuckRefunds.length} refund(s) older than ${windowMinutes}m`
  );

  for (const sale of stuckSales) {
    try {
      const action = await reconcileStuckSale(sale, { branchId });
      results.actions.push(action);
      console.log(`[Fiscal Reconcile] Sale ${sale.id}: ${action.action}`);
    } catch (err) {
      console.error(`[Fiscal Reconcile] Sale ${sale.id} failed:`, err.message);
      results.actions.push({ saleId: sale.id, action: 'error', error: err.message });
    }
  }

  for (const refund of stuckRefunds) {
    try {
      const action = await reconcileStuckRefund(refund, { branchId });
      results.actions.push(action);
      console.log(`[Fiscal Reconcile] Refund ${refund.id}: ${action.action}`);
    } catch (err) {
      console.error(`[Fiscal Reconcile] Refund ${refund.id} failed:`, err.message);
      results.actions.push({ refundId: refund.id, action: 'error', error: err.message });
    }
  }

  return results;
}

module.exports = {
  reconcileStuckFiscalRecords,
  reconcileStuckSale,
  reconcileStuckRefund,
  reconciliationCutoff,
};
