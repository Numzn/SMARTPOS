/**
 * Stock adjustment — the single write path for changing stock outside of a
 * sale, refund or goods receipt.
 *
 * Extracted from routes/inventory/adjustments.js so the CSV importer cannot
 * take a shortcut. Setting stock is not one write: a correct adjustment
 * updates Inventory, appends a StockMovement (the operational ledger and the
 * cost basis the profit report reads), records a StockAdjustment (the ZRA
 * audit trail), and moves batches (a new batch in, FIFO consumption out).
 * A bulk "set currentStock = N" would silently skip three of those.
 *
 * Takes `tx` as its first argument, matching the convention in
 * lib/inventoryStock.js — every mutating helper runs inside the caller's
 * transaction, never its own.
 */

const { deductBatchesFifo } = require('./inventoryStock');

const ADJUSTMENT_DIRECTION = {
  IN: 'IN',
  OUT: 'OUT',
  INCREASE: 'IN',
  DECREASE: 'OUT',
  DAMAGED: 'OUT',
  EXPIRED: 'OUT',
};

const ZRA_AUDIT_TYPE = {
  IN: 'INCREASE',
  OUT: 'DECREASE',
  INCREASE: 'INCREASE',
  DECREASE: 'DECREASE',
  DAMAGED: 'DAMAGED',
  EXPIRED: 'EXPIRED',
  RECOUNT: 'RECOUNT',
};

function resolveAdjustmentType(rawType) {
  const normalized = String(rawType || '').toUpperCase();
  return {
    normalized,
    direction: ADJUSTMENT_DIRECTION[normalized],
    auditType: ZRA_AUDIT_TYPE[normalized],
  };
}

/**
 * Applies one adjustment. Returns { inventory, stockMovement, stockAdjustment }.
 * Throws with .status set so route and importer surface the same errors.
 */
async function applyStockAdjustment(
  tx,
  {
    productId,
    direction,
    auditType,
    quantity,
    reason,
    unitCost,
    // DateTime column — the ZRA yyyymmdd string form is produced at
    // submission time, not stored.
    ocrnDt = new Date(),
    branchId = 'main',
    userId,
  }
) {
  const adjustmentQty = Math.abs(parseInt(quantity, 10));
  if (!adjustmentQty || adjustmentQty < 1) {
    const err = new Error(`Invalid quantity for product ${productId}`);
    err.status = 400;
    throw err;
  }

  let inventory = await tx.inventory.findUnique({
    where: { productId_branchId: { productId, branchId } },
    include: { product: true },
  });

  if (!inventory) {
    // An IN adjustment can bootstrap the inventory row (initial stocking).
    // OUT/DAMAGED/EXPIRED have nothing to remove, so reject.
    if (direction !== 'IN') {
      const err = new Error('Inventory not found for this product');
      err.status = 404;
      throw err;
    }
    inventory = await tx.inventory.create({
      data: {
        productId,
        branchId,
        currentStock: 0,
        averageCost: unitCost || 0,
        lastCost: unitCost || 0,
        totalValue: 0,
        lowStockAlert: true,
      },
      include: { product: true },
    });
  }

  const signedQty = direction === 'IN' ? adjustmentQty : -adjustmentQty;
  const newStock = Math.max(0, inventory.currentStock + signedQty);

  if (direction === 'OUT' && inventory.currentStock < adjustmentQty) {
    const err = new Error(
      `Insufficient stock. Available: ${inventory.currentStock}, Requested: ${adjustmentQty}`
    );
    err.status = 409;
    throw err;
  }

  const unit = unitCost || inventory.averageCost || 0;

  const updatedInventory = await tx.inventory.update({
    where: { id: inventory.id },
    data: {
      currentStock: newStock,
      totalValue: newStock * unit,
      averageCost: unit,
      lowStockAlert: newStock <= inventory.reorderPoint,
      updatedAt: new Date(),
    },
  });

  const stockMovement = await tx.stockMovement.create({
    data: {
      productId,
      branchId,
      movementType: direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
      quantity: signedQty,
      previousStock: inventory.currentStock,
      newStock,
      unitCost: unit,
      totalCost: adjustmentQty * unit,
      referenceType: 'ADJUSTMENT',
      reason: reason || `Stock adjustment ${direction.toLowerCase()}`,
      userId,
    },
  });

  const stockAdjustment = await tx.stockAdjustment.create({
    data: {
      productId,
      adjustmentType: auditType,
      quantity: adjustmentQty,
      reason: reason || `Stock adjustment ${direction.toLowerCase()}`,
      ocrnDt,
      userId,
    },
  });

  if (direction === 'IN') {
    await tx.inventoryBatch.create({
      data: {
        inventoryId: inventory.id,
        productId,
        batchNumber: `ADJ-${Date.now()}`,
        quantity: adjustmentQty,
        unitCost: unit,
        totalCost: adjustmentQty * unit,
        costPrice: unit,
        sellingPrice: unit,
        status: 'ACTIVE',
      },
    });
  } else {
    await deductBatchesFifo(tx, { inventoryId: inventory.id, productId, quantity: adjustmentQty });
  }

  return { inventory: updatedInventory, stockMovement, stockAdjustment };
}

module.exports = {
  ADJUSTMENT_DIRECTION,
  ZRA_AUDIT_TYPE,
  resolveAdjustmentType,
  applyStockAdjustment,
};
