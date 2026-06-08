/**
 * Inventory stock helpers — single place for sale deductions and stock movements.
 */

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
 * Deduct stock when a sale is completed. Records SALE_OUT movement.
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

  if (inventory.currentStock < qty) {
    throw new Error(
      `Insufficient stock for product ${productId}: need ${qty}, have ${inventory.currentStock}`
    );
  }

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
  deductStockForSale,
};
