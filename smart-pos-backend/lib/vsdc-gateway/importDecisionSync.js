/**
 * Item 12* — POST /imports/updateImportItems (VSDC API Spec v1.0.8),
 * "UPDATE IMPORT ITEMS". Confirmed MANDATORY per spec text.
 *
 * Unlike every other sync feature this session, this one cannot be a
 * background "sync all pending X" job: approving or rejecting a customs
 * import line is a business decision a human has to make (which local
 * Product it corresponds to, or that it should be disregarded), not
 * something derivable from local state. This module is the per-item
 * decide step that follows item 11*'s retrieval.
 *
 * A local Product is required for BOTH approve and reject — the spec's
 * Update Import Items Request table marks itemClsCd/itemCd as required
 * (Y) on every submitted line regardless of the decision code, so there
 * is no "reject without a product" shortcut the real fields would allow.
 *
 * Per the spec's own Dependency note ("After your import is approved,
 * call the Save Stock Items endpoint... Subsequently, call the Stock
 * Master endpoint"), an APPROVED decision credits real stock via
 * lib/receiving.js#receiveStock (movementType:'IMPORT_IN', the same
 * weighted-average-cost/batch logic the GRN receiving path already uses,
 * reused rather than duplicated) and then fire-and-forget triggers the
 * existing stock-push follow-up (items 27* and 29*), exactly like item 13*'s
 * purchaseSaveSync.js does for GRNs. A REJECTED decision has no local
 * stock effect at all — spec: "disregarded imported items will not [be
 * saved in stock]."
 */
const prisma = require('../prisma');
const transport = require('./transport');
const endpointAdapter = require('./endpointAdapter');
const auditService = require('../../services/auditService');
const { receiveStock } = require('../receiving');
const { buildUpdateImportItemPayload } = require('./payloadBuilders/updateImportItem');
const { validateUpdateImportItemPayload } = require('./validators/updateImportItem');

function vsdcCtx() {
  const vsdcService = require('../../services/vsdcService');
  return { tpin: vsdcService.tpin, bhfId: vsdcService.bhfId };
}

async function submitDecisionToVsdc(payload) {
  const path = endpointAdapter.path('importsUpdate');
  const res = await transport.authenticatedPost(path, payload);
  if (!res.success) {
    throw new Error(res.data?.resultMsg || 'imports/updateImportItems failed');
  }
  return res.data;
}

async function recordAudit(importItemId, payload, error) {
  try {
    await auditService.logEvent(auditService.eventTypes.PURCHASE_SYNC, {
      entityType: 'RETRIEVED_IMPORT_ITEM',
      entityId: importItemId,
      description: error ? `Import decision sync failed: ${error.message}` : 'Import decision sync succeeded',
      success: !error,
      errorMessage: error ? String(error.message || error) : null,
      metadata: payload,
    });
  } catch (auditErr) {
    console.warn('[importDecisionSync] audit log failed:', auditErr.message);
  }
}

/**
 * decision: 'APPROVED' | 'REJECTED'. productId required for both (see
 * file header). Returns {ok, importItemId, error?} — never throws.
 */
async function decideImportItem(importItemId, { decision, productId, remark, actor } = {}) {
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return { ok: false, error: "decision must be 'APPROVED' or 'REJECTED'" };
  }

  const item = await prisma.retrievedImportItem.findUnique({ where: { id: importItemId } });
  if (!item) return { ok: false, error: 'Import item not found' };
  if (item.decision !== 'PENDING') return { ok: true, skipped: true, importItemId };

  if (!productId) {
    return { ok: false, error: 'productId is required to assign a local classification/SKU to this import line' };
  }
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return { ok: false, error: 'Product not found' };

  const payload = buildUpdateImportItemPayload(item, product, decision, actor, vsdcCtx(), remark);
  const validation = validateUpdateImportItemPayload(payload);
  if (!validation.isValid) {
    return { ok: false, importItemId, error: validation.errors.join(', ') };
  }

  let response;
  try {
    response = await submitDecisionToVsdc(payload);
  } catch (error) {
    await recordAudit(item.id, payload, error);
    return { ok: false, importItemId, error: error.message };
  }

  await prisma.retrievedImportItem.update({
    where: { id: item.id },
    data: {
      decision,
      decidedAt: new Date(),
      decidedBy: actor?.id || null,
      decidedProductId: product.id,
      remark: remark || null,
      zraDecisionSyncedAt: new Date(),
      zraDecisionSyncError: null,
      zraDecisionSyncResponse: response ?? undefined,
    },
  });
  await recordAudit(item.id, payload);

  if (decision === 'APPROVED') {
    const { stockMovement } = await prisma.$transaction((tx) =>
      receiveStock(tx, {
        productId: product.id,
        quantity: item.qty || 0,
        unitCost: 0, // spec's response gives no unit-price field for an import line — honestly 0, not fabricated
        branchId: item.branchId,
        supplierInfo: item.spplrNm || item.agntNm || null,
        userId: actor?.id || null,
        referenceType: 'IMPORT_ITEM',
        referenceId: item.id,
        movementType: 'IMPORT_IN',
      })
    );

    const stockSyncService = require('../../services/stockSyncService');
    stockSyncService.syncAfterMovements([stockMovement.id], item.branchId);
  }

  return { ok: true, importItemId, decision, response };
}

module.exports = { decideImportItem, submitDecisionToVsdc };
