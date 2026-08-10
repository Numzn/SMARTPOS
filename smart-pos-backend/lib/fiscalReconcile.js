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
  finalizeSaleFiscally,
} = require('./saleFiscal');
const { DEFAULT_BRANCH } = require('./inventoryStock');
const { refundInclude, completeRefundAfterFiscalSuccess } = require('./saleRefund');

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
        intrlData: sale.intrlData,
        vsdcRcptPbctDate:
          sale.vsdcRcptPbctDate ?? extractZraFromVsdcPayload(sale.vsdcResponse)?.vsdcRcptPbctDate ?? null,
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
    await completeRefundAfterFiscalSuccess(
      refund.id,
      {
        rcptNo: refund.rcptNo,
        qrCode: refund.qrCode,
        rcptSign: refund.rcptSign,
        intrlData: refund.intrlData,
        vsdcRcptPbctDate:
          refund.vsdcRcptPbctDate ?? extractZraFromVsdcPayload(refund.vsdcResponse)?.vsdcRcptPbctDate ?? null,
      },
      { vsdcRequest: refund.vsdcRequest, vsdcResponse: refund.vsdcResponse },
      branchId
    );
    return { refundId: refund.id, action: 'completed_existing_rcpt' };
  }

  const fromResponse = extractZraFromVsdcPayload(refund.vsdcResponse);
  if (fromResponse?.rcptNo) {
    await completeRefundAfterFiscalSuccess(
      refund.id,
      fromResponse,
      { vsdcResponse: refund.vsdcResponse },
      branchId
    );
    return { refundId: refund.id, action: 'completed_from_vsdcResponse' };
  }

  if (refund.fiscalInvcNo) {
    const lookup = await vsdcService.lookupInvoiceByInvcNo(refund.fiscalInvcNo);
    if (lookup.success) {
      const zra = extractZraFromVsdcPayload(lookup.data);
      if (zra?.rcptNo) {
        await completeRefundAfterFiscalSuccess(
          refund.id,
          zra,
          { vsdcResponse: lookup.data },
          branchId
        );
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

/**
 * Recover a sale stuck in PENDING past the reconciliation window — i.e. checkout
 * created the sale row but never reached (or never finished) VSDC submission,
 * typically because VSDC/network was unreachable and the checkout request died
 * before ever reserving stock or calling submitFiscalForSale. Safe to retry
 * outright (unlike FISCAL_SUBMITTING) because no VSDC submission was ever made.
 *
 * The row is claimed first (conditional update on status='PENDING') so an
 * overlapping reconcile pass or a concurrent manual retry can't both call
 * finalizeSaleFiscally on the same sale and double-submit it to VSDC.
 */
async function reconcileStuckPendingSale(sale, { branchId = DEFAULT_BRANCH } = {}) {
  const claim = await prisma.sale.updateMany({
    where: { id: sale.id, status: 'PENDING' },
    data: { fiscalError: null },
  });

  if (claim.count === 0) {
    return { saleId: sale.id, action: 'skipped_already_claimed' };
  }

  try {
    const result = await finalizeSaleFiscally(sale.id, { branchId });
    if (result.success) {
      return { saleId: sale.id, action: 'retried_and_completed' };
    }
    return { saleId: sale.id, action: 'retried_and_failed', error: result.fiscal?.error };
  } catch (err) {
    return { saleId: sale.id, action: 'retry_deferred', error: err.message };
  }
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

  const stuckPendingSales = await prisma.sale.findMany({
    where: {
      status: 'PENDING',
      updatedAt: { lt: cutoff },
    },
    include: saleInclude,
    take: batchSize,
    orderBy: { updatedAt: 'asc' },
  });

  const results = {
    salesChecked: stuckSales.length,
    refundsChecked: stuckRefunds.length,
    pendingSalesChecked: stuckPendingSales.length,
    actions: [],
  };

  if (stuckSales.length === 0 && stuckRefunds.length === 0 && stuckPendingSales.length === 0) {
    return results;
  }

  console.log(
    `[Fiscal Reconcile] ${stuckSales.length} sale(s), ${stuckRefunds.length} refund(s), ${stuckPendingSales.length} orphaned pending sale(s) older than ${windowMinutes}m`
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

  for (const sale of stuckPendingSales) {
    try {
      const action = await reconcileStuckPendingSale(sale, { branchId });
      results.actions.push(action);
      console.log(`[Fiscal Reconcile] Pending sale ${sale.id}: ${action.action}`);
    } catch (err) {
      console.error(`[Fiscal Reconcile] Pending sale ${sale.id} failed:`, err.message);
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
  reconcileStuckPendingSale,
  reconciliationCutoff,
};
