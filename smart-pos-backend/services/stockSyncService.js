const vsdcService = require('./vsdcService');
const auditService = require('./auditService');
const prisma = require('../lib/prisma');

/** Prisma StockMovementType → VSDC sarTyCd (Section 6.2). */
const MOVEMENT_TYPE_TO_VSDC = {
  PURCHASE_IN: '01',
  SALE_OUT: '02',
  ADJUSTMENT_IN: '03',
  ADJUSTMENT_OUT: '04',
  TRANSFER_IN: '05',
  TRANSFER_OUT: '06',
  PRODUCTION_IN: '07',
  PRODUCTION_OUT: '08',
  RETURN_IN: '11',
  RETURN_OUT: '12',
  RECOUNT: '13',
};

function directionFor(movement) {
  if (movement.quantity > 0) return 'IN';
  if (movement.quantity < 0) return 'OUT';
  if (movement.movementType?.endsWith('_IN')) return 'IN';
  if (movement.movementType?.endsWith('_OUT')) return 'OUT';
  return 'UNKNOWN';
}

function toVsdcPayload(movement) {
  const product = movement.product || {};
  return {
    movementId: movement.id,
    productId: movement.productId,
    branchId: movement.branchId,
    itemCd: product.sku || product.id,
    vsdcCode: MOVEMENT_TYPE_TO_VSDC[movement.movementType] || '02',
    sarTyCd: MOVEMENT_TYPE_TO_VSDC[movement.movementType] || '02',
    sarNo: movement.referenceId || movement.id,
    quantity: Math.abs(movement.quantity),
    qty: Math.abs(movement.quantity),
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
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          zraClassificationCode: true,
          zraRegistrationStatus: true,
        },
      },
    },
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

async function syncMovementById(movementId) {
  const movement = await prisma.stockMovement.findUnique({
    where: { id: movementId },
    include: {
      product: {
        select: { id: true, name: true, sku: true, zraClassificationCode: true },
      },
    },
  });

  if (!movement) {
    return { ok: false, error: 'Movement not found' };
  }
  if (movement.zraSyncedAt) {
    return { ok: true, skipped: true, movementId };
  }

  const payload = toVsdcPayload(movement);
  const result = await submitToVsdc(payload);

  if (result.ok) {
    await markMovementSynced(movement.id, result.response);
    await recordAudit(auditService?.eventTypes?.STOCK_SYNC || 'STOCK_SYNC', payload);
    return { ok: true, movementId, response: result.response };
  }

  await markMovementFailed(movement.id, String(result.error?.message || result.error));
  await recordAudit('STOCK_SYNC_FAIL', payload, result.error);
  return { ok: false, movementId, error: result.error };
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

module.exports = {
  MOVEMENT_TYPE_TO_VSDC,
  toVsdcPayload,
  getPendingMovements,
  submitToVsdc,
  syncMovementById,
  syncRecentMovements,
  syncAfterSale,
};
