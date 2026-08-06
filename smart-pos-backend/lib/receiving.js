/**
 * Shared stock-receiving logic — get-or-create the Inventory row, blend the
 * weighted-average cost, create an InventoryBatch, and record a
 * StockMovement. Extracted from routes/inventory/core.js's POST /receive
 * handler (Phase 3) so the new PO-based GRN receiving flow can reuse the
 * exact same math instead of duplicating it.
 *
 * `tx` is a required first argument, matching every other mutating write
 * helper in lib/inventoryStock.js (deductStockForSale, restoreStockForRefund)
 * — callers open their own transaction and pass it through.
 */

const { DEFAULT_BRANCH } = require('./inventoryStock');

async function receiveStock(
  tx,
  {
    productId,
    quantity,
    unitCost,
    branchId = DEFAULT_BRANCH,
    supplierInfo,
    supplierId = null,
    batchNumber,
    expiryDate,
    receivedDate = new Date(),
    userId,
    referenceType = 'PURCHASE',
    referenceId = null,
  }
) {
  const qty = Math.abs(parseInt(quantity, 10));
  const cost = parseFloat(unitCost);

  let inventory = await tx.inventory.findUnique({
    where: { productId_branchId: { productId, branchId } },
  });

  if (!inventory) {
    inventory = await tx.inventory.create({
      data: { productId, branchId, currentStock: 0, averageCost: 0 },
    });
  }

  const previousStock = inventory.currentStock;
  const newStock = previousStock + qty;

  // Weighted average cost.
  const totalCurrentValue = previousStock * inventory.averageCost;
  const newValue = qty * cost;
  const newAverageCost = (totalCurrentValue + newValue) / newStock;

  const updatedInventory = await tx.inventory.update({
    where: { productId_branchId: { productId, branchId } },
    data: {
      currentStock: newStock,
      averageCost: newAverageCost,
      totalValue: newStock * newAverageCost,
      lastCost: cost,
      lastStockedDate: new Date(),
      lowStockAlert: newStock <= inventory.reorderPoint,
      excessStockAlert: newStock >= inventory.maximumStock,
    },
  });

  const inventoryBatch = await tx.inventoryBatch.create({
    data: {
      inventoryId: inventory.id,
      productId,
      quantity: qty,
      unitCost: cost,
      totalCost: qty * cost,
      costPrice: cost,
      sellingPrice: cost * 1.2, // Default markup
      supplier: supplierInfo || 'Unknown',
      supplierId,
      batchNumber: batchNumber || `BATCH-${Date.now()}`,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      receivedDate: new Date(receivedDate),
      status: 'ACTIVE',
    },
  });

  const stockMovement = await tx.stockMovement.create({
    data: {
      productId,
      branchId,
      movementType: 'PURCHASE_IN',
      quantity: qty,
      previousStock,
      newStock,
      unitCost: cost,
      totalCost: qty * cost,
      referenceType,
      referenceId,
      supplierInfo,
      batchNumber,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      userId,
    },
  });

  return { updatedInventory, inventoryBatch, stockMovement };
}

module.exports = { receiveStock };
