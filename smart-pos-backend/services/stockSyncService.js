const vsdcService = require('./vsdcService');
const auditService = require('./auditService');
const zraCodesService = require('./zraCodesService');
const prisma = require('../lib/prisma');

const PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  zraClassificationCode: true,
  zraRegistrationStatus: true,
  taxType: true,
  zraPackageUnit: true,
  zraQuantityUnit: true,
};

// Prisma StockMovementType -> VSDC sarTyCd (spec §6.14 "Stock In/Out Type"),
// confirmed directly against the spec text (vsdc-extracted.txt), not
// guessed. Corrected 2026-08-12: every value here was previously wrong —
// e.g. SALE_OUT was '02' (real: '11'; '02' is actually "Incoming-Purchase",
// the opposite direction of what it was tagging) and PURCHASE_IN was '01'
// (real: '02'; '01' is "Incoming-Import"). Real table:
//   01 Import-in     02 Purchase-in    03 Return-in     04 StockMovement-in
//   05 Processing-in 06 Adjustment-in
//   11 Sale-out      12 Return-out     13 StockMovement-out
//   14 Processing-out 15 Discarding-out 16 Adjustment-out
// RECOUNT has no dedicated code in the spec — resolved by direction
// (quantity sign) to the nearest equivalent (Adjustment in/out) in
// sarTyCdFor() below, rather than a fabricated table entry.
const MOVEMENT_TYPE_TO_VSDC = {
  PURCHASE_IN: '02',
  SALE_OUT: '11',
  ADJUSTMENT_IN: '06',
  ADJUSTMENT_OUT: '16',
  TRANSFER_IN: '04',
  TRANSFER_OUT: '13',
  PRODUCTION_IN: '05',
  PRODUCTION_OUT: '14',
  RETURN_IN: '03',
  RETURN_OUT: '12',
};

function directionFor(movement) {
  if (movement.quantity > 0) return 'IN';
  if (movement.quantity < 0) return 'OUT';
  if (movement.movementType?.endsWith('_IN')) return 'IN';
  if (movement.movementType?.endsWith('_OUT')) return 'OUT';
  return 'UNKNOWN';
}

function sarTyCdFor(movement) {
  const direct = MOVEMENT_TYPE_TO_VSDC[movement.movementType];
  if (direct) return direct;
  return directionFor(movement) === 'OUT' ? '16' : '06';
}

// Resolves pkgUnitCd/qtyUnitCd/vatCatCd from the product's own explicit
// fields, falling back to the synced-ZraCode default resolution
// (zraCodesService.resolveDefaultCode) — the same "throw rather than
// silently guess if codes were never synced" rule used for item
// registration (services/itemManagement.js), not a fabricated literal.
async function resolveVsdcCodes(product) {
  const [pkgUnitCd, qtyUnitCd, vatCatCd] = await Promise.all([
    product.zraPackageUnit ? product.zraPackageUnit : zraCodesService.resolveDefaultCode('PACKAGING_UNITS', 'BX').then((r) => r.code),
    product.zraQuantityUnit ? product.zraQuantityUnit : zraCodesService.resolveDefaultCode('UNIT_OF_MEASURE', 'EA').then((r) => r.code),
    product.taxType ? product.taxType : zraCodesService.getDefaultTaxTypeCode(),
  ]);
  return { pkgUnitCd, qtyUnitCd, vatCatCd };
}

// Async: resolving pkgUnitCd/qtyUnitCd/vatCatCd may need a live sync check
// (see resolveVsdcCodes) the same way item registration does.
async function toVsdcPayload(movement) {
  const product = movement.product || {};
  const sarTyCd = sarTyCdFor(movement);
  const { pkgUnitCd, qtyUnitCd, vatCatCd } = await resolveVsdcCodes(product);
  const qty = Math.abs(movement.quantity);
  // Stock-movement amounts are the cost basis of the movement, not a sale
  // (VAT on an actual taxable supply is reported separately via
  // saveSales) — so prc/splyAmt/taxblAmt come from tracked unit cost, and
  // tax/IPL/TL/excise amounts are honestly 0 rather than fabricated, since
  // no per-movement tax computation is tracked here.
  const prc = movement.unitCost ?? 0;
  const splyAmt = Number((qty * prc).toFixed(2));
  return {
    movementId: movement.id,
    productId: movement.productId,
    branchId: movement.branchId,
    itemCd: product.sku || product.id,
    itemClsCd: product.zraClassificationCode || null,
    itemNm: product.name || null,
    pkgUnitCd,
    qtyUnitCd,
    vatCatCd,
    vsdcCode: sarTyCd,
    sarTyCd,
    sarNo: movement.referenceId || movement.id,
    quantity: qty,
    qty,
    prc,
    splyAmt,
    taxblAmt: splyAmt,
    taxAmt: 0,
    totAmt: splyAmt,
    direction: directionFor(movement),
    previousStock: movement.previousStock,
    newStock: movement.newStock,
    unitCost: movement.unitCost ?? null,
    totalCost: movement.totalCost ?? null,
    referenceType: movement.referenceType ?? null,
    referenceId: movement.referenceId ?? null,
    occurredAt: movement.createdAt,
  };
}

async function recordAudit(eventType, payload, error) {
  if (!auditService || typeof auditService.logEvent !== 'function') return;
  try {
    await auditService.logEvent(eventType, {
      entityType: 'stock_movement',
      entityId: payload.movementId,
      description: error ? `Stock sync failed: ${error}` : 'Stock sync attempt',
      success: !error,
      errorMessage: error ? String(error.message || error) : null,
      metadata: payload,
    });
  } catch (auditErr) {
    console.warn('[stockSyncService] audit log failed:', auditErr.message);
  }
}

async function getPendingMovements({ branchId, referenceId, since, limit = 100 } = {}) {
  const where = { zraSyncedAt: null };
  if (branchId) where.branchId = branchId;
  if (referenceId) where.referenceId = referenceId;
  if (since) where.createdAt = { gte: since };

  return prisma.stockMovement.findMany({
    where,
    include: { product: { select: PRODUCT_SELECT } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

async function markMovementSynced(movementId, response) {
  await prisma.stockMovement.update({
    where: { id: movementId },
    data: {
      zraSyncedAt: new Date(),
      zraSyncError: null,
      zraSyncResponse: response ?? undefined,
    },
  });
}

async function markMovementFailed(movementId, errorMessage) {
  await prisma.stockMovement.update({
    where: { id: movementId },
    data: {
      zraSyncError: errorMessage,
    },
  });
}

async function submitToVsdc(payload) {
  if (!vsdcService || typeof vsdcService.submitStockIo !== 'function') {
    return { ok: false, mode: 'unsupported', error: new Error('submitStockIo not available') };
  }
  try {
    const response = await vsdcService.submitStockIo(payload);
    return { ok: true, mode: 'live', response };
  } catch (error) {
    return { ok: false, mode: 'live', error };
  }
}

// Spec dependency: "subsequent call to saveStockMaster should be made
// after [saveStockItems] is called" — with the *resulting* quantity
// (rsdQty), not a delta. movement.newStock already is that value.
async function submitMasterToVsdc(payload) {
  if (!vsdcService || typeof vsdcService.submitStockMaster !== 'function') {
    return { ok: false, mode: 'unsupported', error: new Error('submitStockMaster not available') };
  }
  try {
    const response = await vsdcService.submitStockMaster([
      { itemCd: payload.itemCd, rsdQty: payload.newStock },
    ]);
    return { ok: true, mode: 'live', response };
  } catch (error) {
    return { ok: false, mode: 'live', error };
  }
}

async function syncMovementById(movementId) {
  const movement = await prisma.stockMovement.findUnique({
    where: { id: movementId },
    include: { product: { select: PRODUCT_SELECT } },
  });

  if (!movement) {
    return { ok: false, error: 'Movement not found' };
  }
  if (movement.zraSyncedAt) {
    return { ok: true, skipped: true, movementId };
  }

  const payload = await toVsdcPayload(movement);
  const itemResult = await submitToVsdc(payload);

  if (!itemResult.ok) {
    await markMovementFailed(movement.id, String(itemResult.error?.message || itemResult.error));
    await recordAudit('STOCK_SYNC_FAIL', payload, itemResult.error);
    return { ok: false, movementId, error: itemResult.error };
  }

  const masterResult = await submitMasterToVsdc(payload);
  if (!masterResult.ok) {
    const message = `saveStockItems succeeded but saveStockMaster failed: ${masterResult.error?.message || masterResult.error}`;
    await markMovementFailed(movement.id, message);
    await recordAudit('STOCK_SYNC_FAIL', payload, new Error(message));
    return { ok: false, movementId, error: new Error(message) };
  }

  await markMovementSynced(movement.id, { item: itemResult.response, master: masterResult.response });
  await recordAudit(auditService?.eventTypes?.STOCK_SYNC || 'STOCK_SYNC', payload);
  return { ok: true, movementId, response: { item: itemResult.response, master: masterResult.response } };
}

async function syncRecentMovements(options = {}) {
  const movements = await getPendingMovements(options);
  let succeeded = 0;
  let failed = 0;
  const items = [];

  for (const movement of movements) {
    const result = await syncMovementById(movement.id);
    items.push(result);
    if (result.ok) succeeded += 1;
    else failed += 1;
  }

  return {
    attempted: movements.length,
    succeeded,
    failed,
    items,
  };
}

/** Fire-and-forget sync for a sale reference; never throws. */
function syncAfterSale(saleId, branchId = 'main') {
  syncRecentMovements({ referenceId: saleId, branchId }).catch((err) => {
    console.warn('[stockSyncService] post-sale sync failed:', err.message);
  });
}

/** Fire-and-forget sync for one or more movement ids; never throws. */
function syncAfterMovements(movementIds, branchId = 'main') {
  const ids = (Array.isArray(movementIds) ? movementIds : [movementIds]).filter(Boolean);
  if (ids.length === 0) return;

  Promise.all(ids.map((id) => syncMovementById(id)))
    .then((results) => {
      const failed = results.filter((r) => !r.ok && !r.skipped);
      if (failed.length) {
        console.warn(
          `[stockSyncService] ${failed.length}/${ids.length} movement sync(s) failed (branch=${branchId})`
        );
      }
    })
    .catch((err) => {
      console.warn('[stockSyncService] post-movement sync failed:', err.message);
    });
}

module.exports = {
  MOVEMENT_TYPE_TO_VSDC,
  toVsdcPayload,
  getPendingMovements,
  submitToVsdc,
  syncMovementById,
  syncRecentMovements,
  syncAfterSale,
  syncAfterMovements,
};
