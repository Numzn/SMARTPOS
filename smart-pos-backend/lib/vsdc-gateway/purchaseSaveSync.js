/**
 * Item 13* — POST /trnsPurchase/savePurchase (VSDC API Spec v1.0.8). Spec
 * text confirms the path is SINGULAR ("savePurchase"), MANDATORY.
 *
 * Pushes each unsynced GoodsReceivedNote as a purchase document. One SAVE
 * PURCHASES call per GRN — cisInvcNo (our own reference number) is a
 * single-document field, and GoodsReceivedNote.grnNumber is already the
 * natural per-document identifier. regTyCd is always 'M' (Manual): we have
 * no reliable signal that a supplier already self-reported this purchase
 * via their own VSDC, so every GRN we push is self-reported — see
 * zra-self-checklist.md item 13*'s row for the full reasoning. Item 14*
 * (purchaseRetrieveSync.js) is a separate, uncoupled reconciliation
 * feature, not a trigger for what to submit here.
 *
 * Per the spec's own "Dependency" note ("Upon approval of a purchase, you
 * must call the Save Stock Items endpoint... Subsequently, call the Stock
 * Master endpoint"), a successful purchase submission triggers the
 * existing stock-push follow-up (items 27* and 29*, stockSyncService.js) for
 * this GRN's still-unsynced PURCHASE_IN movements — fire-and-forget, never
 * blocking the purchase result on that follow-up's own outcome.
 */
const prisma = require('../prisma');
const transport = require('./transport');
const endpointAdapter = require('./endpointAdapter');
const auditService = require('../../services/auditService');
const { buildSavePurchasePayload } = require('./payloadBuilders/savePurchase');
const { validateSavePurchasePayload } = require('./validators/savePurchase');

function vsdcCtx() {
  const vsdcService = require('../../services/vsdcService');
  return { tpin: vsdcService.tpin, bhfId: vsdcService.bhfId };
}

const GRN_INCLUDE = {
  supplier: true,
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          zraClassificationCode: true,
          zraItemClassification: true,
          zraPackageUnit: true,
          zraQuantityUnit: true,
          taxType: true,
        },
      },
    },
  },
};

async function getPendingGrns({ branchId, limit = 50 } = {}) {
  const where = { zraSyncedAt: null };
  if (branchId) where.branchId = branchId;
  return prisma.goodsReceivedNote.findMany({
    where,
    include: GRN_INCLUDE,
    orderBy: { receivedDate: 'asc' },
    take: limit,
  });
}

async function markGrnSynced(grnId, response) {
  await prisma.goodsReceivedNote.update({
    where: { id: grnId },
    data: { zraSyncedAt: new Date(), zraSyncError: null, zraSyncResponse: response ?? undefined },
  });
}

async function markGrnFailed(grnId, errorMessage) {
  await prisma.goodsReceivedNote.update({
    where: { id: grnId },
    data: { zraSyncError: errorMessage },
  });
}

async function submitPurchaseToVsdc(payload) {
  const path = endpointAdapter.path('purchaseSave');
  const res = await transport.authenticatedPost(path, payload);
  if (!res.success) {
    throw new Error(res.data?.resultMsg || 'trnsPurchase/savePurchase failed');
  }
  return res.data;
}

async function recordAudit(grnId, payload, error) {
  try {
    await auditService.logEvent(auditService.eventTypes.PURCHASE_SYNC, {
      entityType: 'GOODS_RECEIVED_NOTE',
      entityId: grnId,
      description: error ? `Purchase sync failed: ${error.message}` : 'Purchase sync succeeded',
      success: !error,
      errorMessage: error ? String(error.message || error) : null,
      metadata: payload,
    });
  } catch (auditErr) {
    console.warn('[purchaseSaveSync] audit log failed:', auditErr.message);
  }
}

/**
 * Submits one GRN's SAVE PURCHASES payload. Never advances past an
 * already-synced GRN (idempotent — re-running is safe). A validation or
 * VSDC failure marks zraSyncError only, leaving zraSyncedAt untouched so
 * a retry is picked up again by getPendingGrns().
 */
async function syncGrnById(grnId) {
  const grn = await prisma.goodsReceivedNote.findUnique({ where: { id: grnId }, include: GRN_INCLUDE });
  if (!grn) return { ok: false, error: 'GRN not found' };
  if (grn.zraSyncedAt) return { ok: true, skipped: true, grnId };

  const payload = buildSavePurchasePayload(grn, vsdcCtx());
  const validation = validateSavePurchasePayload(payload);
  if (!validation.isValid) {
    const message = validation.errors.join(', ');
    await markGrnFailed(grn.id, message);
    await recordAudit(grn.id, payload, new Error(message));
    return { ok: false, grnId, error: message };
  }

  let response;
  try {
    response = await submitPurchaseToVsdc(payload);
  } catch (error) {
    await markGrnFailed(grn.id, error.message);
    await recordAudit(grn.id, payload, error);
    return { ok: false, grnId, error: error.message };
  }

  await markGrnSynced(grn.id, response);
  await recordAudit(grn.id, payload);

  const unsyncedMovements = await prisma.stockMovement.findMany({
    where: { referenceType: 'PURCHASE_ORDER', referenceId: grn.id, zraSyncedAt: null },
    select: { id: true },
  });
  if (unsyncedMovements.length > 0) {
    const stockSyncService = require('../../services/stockSyncService');
    stockSyncService.syncAfterMovements(unsyncedMovements.map((m) => m.id), grn.branchId);
  }

  return { ok: true, grnId, response };
}

async function syncPendingGrns(options = {}) {
  const grns = await getPendingGrns(options);
  let succeeded = 0;
  let failed = 0;
  const items = [];

  for (const grn of grns) {
    const result = await syncGrnById(grn.id);
    items.push(result);
    if (result.ok) succeeded += 1;
    else failed += 1;
  }

  return { attempted: grns.length, succeeded, failed, items };
}

module.exports = {
  getPendingGrns,
  submitPurchaseToVsdc,
  syncGrnById,
  syncPendingGrns,
};
