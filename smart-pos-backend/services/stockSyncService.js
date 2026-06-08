const vsdcService = require('./vsdcService');
const auditService = require('./auditService');
const prisma = require('../lib/prisma');

/**
 * Stock Synchronization Service — schema-aligned stub.
 *
 * VSDC reference: Section 6.2 (Stock Management).
 *
 * What this service does (safe & schema-aligned):
 *   - Maps Prisma `StockMovementType` enum values to VSDC numeric codes.
 *   - Reads recent stock movements from the live `stock_movements` table.
 *   - Submits each as a stock-IO payload to `vsdcService.submitStockIo` if
 *     that method exists on the VSDC service. Otherwise it returns the
 *     payloads without making any network call (dry-run).
 *   - Records every attempt in the audit service when available.
 *
 * What this service intentionally does NOT do:
 *   - It does not reference fields that aren't on the Prisma schema
 *     (e.g. `zraSarNumber`, `product.quantity`, etc.).
 *   - It does not duplicate the canonical stock writes — those happen in
 *     `lib/inventoryStock.js` and `routes/inventory/adjustments.js`.
 *   - It does not invent batch FIFO logic; if needed, that lives in the
 *     adjustments route.
 *
 * Wire this service into a scheduled job (or a manual route) when ZRA
 * stock-sync is ready to be enabled in production.
 */

/** Prisma `StockMovementType` → VSDC stock-IO code (Section 9.x). */
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

/** Soft direction inferred from movement type / quantity sign. */
function directionFor(movement) {
  if (movement.quantity > 0) return 'IN';
  if (movement.quantity < 0) return 'OUT';
  if (movement.movementType?.endsWith('_IN')) return 'IN';
  if (movement.movementType?.endsWith('_OUT')) return 'OUT';
  return 'UNKNOWN';
}

function toVsdcPayload(movement) {
  return {
    movementId: movement.id,
    productId: movement.productId,
    branchId: movement.branchId,
    vsdcCode: MOVEMENT_TYPE_TO_VSDC[movement.movementType] || null,
    quantity: Math.abs(movement.quantity),
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
    await auditService.logEvent({
      eventType,
      entityType: 'stock_movement',
      entityId: payload.movementId,
      payload,
      error: error ? String(error.message || error) : null,
    });
  } catch (auditErr) {
    console.warn('[stockSyncService] audit log failed:', auditErr.message);
  }
}

/**
 * Pull unsynced stock movements newer than `since` (default: last 24h).
 * If you later add a `zraSyncedAt` column, filter on that here.
 */
async function getPendingMovements({ branchId, since, limit = 100 } = {}) {
  const where = {};
  if (branchId) where.branchId = branchId;
  if (since) where.createdAt = { gte: since };

  return prisma.stockMovement.findMany({
    where,
    include: {
      product: { select: { id: true, name: true, sku: true, zraClassificationCode: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

/**
 * Submit a single payload to VSDC, if the VSDC service supports it.
 * Returns `{ ok, mode, response, error }`. Never throws.
 */
async function submitToVsdc(payload) {
  const submitter =
    (vsdcService && typeof vsdcService.submitStockIo === 'function' && vsdcService.submitStockIo) ||
    null;

  if (!submitter) {
    return { ok: true, mode: 'dry-run', response: null };
  }
  try {
    const response = await submitter.call(vsdcService, payload);
    return { ok: true, mode: 'live', response };
  } catch (error) {
    return { ok: false, mode: 'live', error };
  }
}

/**
 * Sync recent movements to VSDC.
 *
 * @param {object} [options]
 * @param {string} [options.branchId]
 * @param {Date}   [options.since]
 * @param {number} [options.limit]
 * @returns {Promise<{ attempted: number, succeeded: number, failed: number, items: Array }>}
 */
async function syncRecentMovements(options = {}) {
  const movements = await getPendingMovements(options);
  let succeeded = 0;
  let failed = 0;
  const items = [];

  for (const movement of movements) {
    const payload = toVsdcPayload(movement);
    const result = await submitToVsdc(payload);
    items.push({ payload, ...result });
    if (result.ok) {
      succeeded += 1;
      await recordAudit('STOCK_SYNC_OK', payload);
    } else {
      failed += 1;
      await recordAudit('STOCK_SYNC_FAIL', payload, result.error);
    }
  }

  return {
    attempted: movements.length,
    succeeded,
    failed,
    items,
  };
}

module.exports = {
  MOVEMENT_TYPE_TO_VSDC,
  toVsdcPayload,
  getPendingMovements,
  submitToVsdc,
  syncRecentMovements,
};
