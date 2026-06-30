/**
 * Inventory stock helpers — single place for sale deductions and stock movements.
 */

const prisma = require('./prisma');

const DEFAULT_BRANCH = 'main';

function availableUnits(inventory) {
  const current = inventory?.currentStock ?? 0;
  const reserved = inventory?.reservedStock ?? 0;
  return Math.max(0, current - reserved);
}

/**
 * Lock inventory row (SELECT … FOR UPDATE). Creates row if missing.
 */
async function lockInventoryRow(tx, productId, branchId = DEFAULT_BRANCH) {
  await getOrCreateInventory(tx, productId, branchId);

  const rows = await tx.$queryRaw`
    SELECT id, "currentStock", "reservedStock", "reorderPoint", "maximumStock",
           "averageCost", "productId", "branchId"
    FROM inventory
    WHERE "productId" = ${productId} AND "branchId" = ${branchId}
    FOR UPDATE
  `;

  if (!rows.length) {
    throw new Error(`Inventory lock failed for product ${productId}`);
  }

  return rows[0];
}

/**
 * Ensure an inventory row exists for product + branch.
 */
async function getOrCreateInventory(tx, productId, branchId = DEFAULT_BRANCH) {
  let inventory = await tx.inventory.findUnique({
    where: {
      productId_branchId: { productId, branchId },
    },
  });

  if (!inventory) {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { minStockLevel: true, cost: true, price: true },
    });

    inventory = await tx.inventory.create({
      data: {
        productId,
        branchId,
        currentStock: 0,
        reservedStock: 0,
        minimumStock: product?.minStockLevel ?? 0,
        maximumStock: 1000,
        reorderPoint: product?.minStockLevel ?? 10,
        reorderQuantity: 50,
        averageCost: product?.cost ?? product?.price ?? 0,
        lastCost: product?.cost ?? product?.price ?? 0,
        totalValue: 0,
        lowStockAlert: true,
      },
    });
  }

  return inventory;
}

function insufficientStockError(productId, requested, available, tx) {
  return tx.product
    .findUnique({
      where: { id: productId },
      select: { name: true, sku: true },
    })
    .then((product) => {
      const label = product?.name || product?.sku || productId;
      const err = new Error(
        `Insufficient stock for ${label}: requested ${requested}, available ${available}`
      );
      err.status = 409;
      throw err;
    });
}

/**
 * FIFO deduction from ACTIVE batches with row locks (expiry first, then oldest received).
 */
async function deductBatchesFifo(tx, { inventoryId, productId, quantity }) {
  const qty = Math.abs(parseInt(quantity, 10));
  if (!qty || qty < 1) return;

  const activeBatches = await tx.$queryRaw`
    SELECT id, quantity
    FROM inventory_batches
    WHERE "productId" = ${productId}
      AND status = 'ACTIVE'
      AND quantity > 0
    ORDER BY "expiryDate" ASC NULLS LAST, "receivedDate" ASC, "createdAt" ASC
    FOR UPDATE
  `;

  const batchTotal = activeBatches.reduce((sum, batch) => sum + Number(batch.quantity), 0);
  if (batchTotal < qty) {
    throw new Error(
      `Batch stock mismatch for product ${productId}: requested ${qty}, batch sum ${batchTotal}`
    );
  }

  let remaining = qty;
  for (const batch of activeBatches) {
    if (remaining <= 0) break;
    const batchQty = Number(batch.quantity);
    const reduceFromBatch = Math.min(batchQty, remaining);
    const newBatchQuantity = batchQty - reduceFromBatch;
    await tx.inventoryBatch.update({
      where: { id: batch.id },
      data: {
        quantity: newBatchQuantity,
        status: newBatchQuantity === 0 ? 'SOLD_OUT' : 'ACTIVE',
      },
    });
    remaining -= reduceFromBatch;
  }
}

/**
 * Validate cart lines against sellable stock (current − reserved).
 * Uses row locks when run inside a transaction.
 */
async function assertSufficientStock(items, branchId = DEFAULT_BRANCH, prismaClient = prisma) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('At least one item is required');
    err.status = 400;
    throw err;
  }

  const runAssert = async (tx) => {
    for (const item of items) {
      const requested = parseInt(item.quantity, 10);
      if (!requested || requested < 1) {
        const err = new Error(`Invalid quantity for product ${item.productId}`);
        err.status = 400;
        throw err;
      }

      const inv = await lockInventoryRow(tx, item.productId, branchId);
      const available = availableUnits(inv);
      if (requested > available) {
        await insufficientStockError(item.productId, requested, available, tx);
      }
    }
  };

  if (typeof prismaClient.$transaction === 'function') {
    return prismaClient.$transaction(runAssert);
  }

  return runAssert(prismaClient);
}

/**
 * Reserve stock while sale is being submitted to VSDC (fiscal lock pattern).
 */
async function reserveStockForSale(tx, { productId, quantity, branchId = DEFAULT_BRANCH }) {
  const qty = Math.abs(parseInt(quantity, 10));
  if (!qty || qty < 1) {
    throw new Error(`Invalid quantity for product ${productId}`);
  }

  const inv = await lockInventoryRow(tx, productId, branchId);
  const available = availableUnits(inv);
  if (qty > available) {
    await insufficientStockError(productId, qty, available, tx);
  }

  await tx.inventory.update({
    where: { productId_branchId: { productId, branchId } },
    data: { reservedStock: (inv.reservedStock ?? 0) + qty },
  });
}

/**
 * Release reservation when fiscal submission fails or is reconciled as not found.
 */
async function releaseStockReservationForSale(tx, sale, branchId = DEFAULT_BRANCH) {
  for (const item of sale.saleItems || []) {
    const inv = await lockInventoryRow(tx, item.productId, branchId);
    const nextReserved = Math.max(0, (inv.reservedStock ?? 0) - item.quantity);
    await tx.inventory.update({
      where: { productId_branchId: { productId: item.productId, branchId } },
      data: { reservedStock: nextReserved },
    });
  }
}

/**
 * Deduct stock when a sale is completed. Records SALE_OUT movement and FIFO batches.
 */
async function deductStockForSale(
  tx,
  { productId, quantity, branchId = DEFAULT_BRANCH, userId, saleId }
) {
  const qty = Math.abs(parseInt(quantity, 10));
  if (!qty || qty < 1) {
    throw new Error(`Invalid quantity for product ${productId}`);
  }

  const inv = await lockInventoryRow(tx, productId, branchId);
  const available = availableUnits(inv);

  if (qty > available) {
    await insufficientStockError(productId, qty, available, tx);
  }

  const inventory = await tx.inventory.findUnique({
    where: { productId_branchId: { productId, branchId } },
  });

  await deductBatchesFifo(tx, {
    inventoryId: inventory.id,
    productId,
    quantity: qty,
  });

  const previousStock = inventory.currentStock;
  const newStock = previousStock - qty;
  const unitCost = inventory.averageCost || 0;
  const nextReserved = Math.max(0, (inv.reservedStock ?? 0) - qty);

  const updated = await tx.inventory.update({
    where: {
      productId_branchId: { productId, branchId },
    },
    data: {
      currentStock: newStock,
      reservedStock: nextReserved,
      totalValue: newStock * unitCost,
      lastSoldDate: new Date(),
      lowStockAlert: newStock <= inventory.reorderPoint,
      excessStockAlert: newStock >= inventory.maximumStock,
    },
  });

  await tx.stockMovement.create({
    data: {
      productId,
      branchId,
      movementType: 'SALE_OUT',
      quantity: -qty,
      previousStock,
      newStock,
      unitCost,
      totalCost: qty * unitCost,
      referenceType: 'SALE',
      referenceId: saleId,
      userId,
    },
  });

  return updated;
}

/**
 * Restore stock after a fiscal refund (RETURN_IN movement + batch).
 */
async function restoreStockForRefund(
  tx,
  { productId, quantity, branchId = DEFAULT_BRANCH, userId, refundId }
) {
  const qty = Math.abs(parseInt(quantity, 10));
  if (!qty || qty < 1) {
    throw new Error(`Invalid refund quantity for product ${productId}`);
  }

  const inventory = await getOrCreateInventory(tx, productId, branchId);
  const unitCost = inventory.averageCost || 0;
  const previousStock = inventory.currentStock;
  const newStock = previousStock + qty;

  await tx.inventoryBatch.create({
    data: {
      inventoryId: inventory.id,
      productId,
      batchNumber: `RFD-${String(refundId).slice(-8)}-${Date.now()}`,
      quantity: qty,
      unitCost,
      totalCost: qty * unitCost,
      costPrice: unitCost,
      sellingPrice: unitCost * 1.2,
      status: 'ACTIVE',
    },
  });

  const updated = await tx.inventory.update({
    where: { productId_branchId: { productId, branchId } },
    data: {
      currentStock: newStock,
      totalValue: newStock * unitCost,
      lowStockAlert: newStock <= inventory.reorderPoint,
      excessStockAlert: newStock >= inventory.maximumStock,
    },
  });

  await tx.stockMovement.create({
    data: {
      productId,
      branchId,
      movementType: 'RETURN_IN',
      quantity: qty,
      previousStock,
      newStock,
      unitCost,
      totalCost: qty * unitCost,
      referenceType: 'REFUND',
      referenceId: refundId,
      userId,
    },
  });

  return updated;
}

module.exports = {
  DEFAULT_BRANCH,
  availableUnits,
  lockInventoryRow,
  getOrCreateInventory,
  deductBatchesFifo,
  assertSufficientStock,
  reserveStockForSale,
  releaseStockReservationForSale,
  deductStockForSale,
  restoreStockForRefund,
};
