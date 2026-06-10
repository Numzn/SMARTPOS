/**
 * Inventory stock helpers — single place for sale deductions and stock movements.
 */

const prisma = require('./prisma');

const DEFAULT_BRANCH = 'main';

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

/**
 * FIFO deduction from ACTIVE batches (expiry first, then oldest received).
 */
async function deductBatchesFifo(tx, { inventoryId, productId, quantity }) {
  const qty = Math.abs(parseInt(quantity, 10));
  if (!qty || qty < 1) return;

  const activeBatches = await tx.inventoryBatch.findMany({
    where: {
      productId,
      ...(inventoryId ? { inventoryId } : {}),
      status: 'ACTIVE',
      quantity: { gt: 0 },
    },
    orderBy: [{ expiryDate: 'asc' }, { receivedDate: 'asc' }, { createdAt: 'asc' }],
  });

  const batchTotal = activeBatches.reduce((sum, batch) => sum + batch.quantity, 0);
  if (batchTotal < qty) {
    throw new Error(
      `Batch stock mismatch for product ${productId}: requested ${qty}, batch sum ${batchTotal}`
    );
  }

  let remaining = qty;
  for (const batch of activeBatches) {
    if (remaining <= 0) break;
    const reduceFromBatch = Math.min(batch.quantity, remaining);
    const newBatchQuantity = batch.quantity - reduceFromBatch;
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
 * Validate cart lines against available stock (inventory.currentStock).
 * @throws Error with status 409 when requested > available
 */
async function assertSufficientStock(items, branchId = DEFAULT_BRANCH, prismaClient = prisma) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('At least one item is required');
    err.status = 400;
    throw err;
  }

  for (const item of items) {
    const requested = parseInt(item.quantity, 10);
    if (!requested || requested < 1) {
      const err = new Error(`Invalid quantity for product ${item.productId}`);
      err.status = 400;
      throw err;
    }

    const product = await prismaClient.product.findUnique({
      where: { id: item.productId },
      select: { name: true, sku: true },
    });

    const inventory = await prismaClient.inventory.findUnique({
      where: {
        productId_branchId: { productId: item.productId, branchId },
      },
    });

    const available = inventory?.currentStock ?? 0;
    if (requested > available) {
      const label = product?.name || product?.sku || item.productId;
      const err = new Error(
        `Insufficient stock for ${label}: requested ${requested}, available ${available}`
      );
      err.status = 409;
      throw err;
    }
  }
}

/**
 * Deduct stock when a sale is completed. Records SALE_OUT movement and FIFO batches.
 * @throws Error if insufficient stock
 */
async function deductStockForSale(
  tx,
  { productId, quantity, branchId = DEFAULT_BRANCH, userId, saleId }
) {
  const qty = Math.abs(parseInt(quantity, 10));
  if (!qty || qty < 1) {
    throw new Error(`Invalid quantity for product ${productId}`);
  }

  const inventory = await getOrCreateInventory(tx, productId, branchId);
  const available = inventory.currentStock;

  if (qty > available) {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { name: true, sku: true },
    });
    const label = product?.name || product?.sku || productId;
    throw new Error(
      `Insufficient stock for ${label}: requested ${qty}, available ${available}`
    );
  }

  await deductBatchesFifo(tx, {
    inventoryId: inventory.id,
    productId,
    quantity: qty,
  });

  const previousStock = inventory.currentStock;
  const newStock = previousStock - qty;
  const unitCost = inventory.averageCost || 0;

  const updated = await tx.inventory.update({
    where: {
      productId_branchId: { productId, branchId },
    },
    data: {
      currentStock: newStock,
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

module.exports = {
  DEFAULT_BRANCH,
  getOrCreateInventory,
  deductBatchesFifo,
  assertSufficientStock,
  deductStockForSale,
};
