/**
 * Stock sent back to a supplier — single-step, non-fiscal (not a VSDC event,
 * unlike sale refunds). Mirrors lib/saleFiscal.js's deductStockForSale
 * atomicity: lock the inventory row, consume FIFO batches, decrement stock,
 * and write a RETURN_OUT movement, all in one transaction.
 */

const prisma = require('./prisma');
const { DEFAULT_BRANCH, lockInventoryRow, availableUnits, deductBatchesFifo } = require('./inventoryStock');
const { nextSequentialNumber } = require('./sequentialNumber');

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('At least one item is required');
    err.status = 400;
    throw err;
  }
  for (const item of items) {
    const qty = Number(item.quantity);
    if (!item.productId) {
      const err = new Error('Each item requires a productId');
      err.status = 400;
      throw err;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      const err = new Error(`Invalid quantity for product ${item.productId}`);
      err.status = 400;
      throw err;
    }
  }
}

async function createSupplierReturn({ supplierId, branchId = DEFAULT_BRANCH, items, reason, userId }) {
  if (!supplierId) {
    const err = new Error('supplierId is required');
    err.status = 400;
    throw err;
  }
  if (!userId) {
    const err = new Error('userId is required');
    err.status = 400;
    throw err;
  }
  validateItems(items);

  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier || !supplier.isActive) {
      const err = new Error('Supplier not found or inactive');
      err.status = 400;
      throw err;
    }

    let subtotal = 0;
    const itemRows = [];

    for (const item of items) {
      const qty = Math.abs(parseInt(item.quantity, 10));

      const inv = await lockInventoryRow(tx, item.productId, branchId);
      const available = availableUnits(inv);
      if (qty > available) {
        const product = await tx.product.findUnique({ where: { id: item.productId }, select: { name: true, sku: true } });
        const label = product?.name || product?.sku || item.productId;
        const err = new Error(`Insufficient stock for ${label}: requested ${qty}, available ${available}`);
        err.status = 409;
        throw err;
      }

      const inventory = await tx.inventory.findUnique({
        where: { productId_branchId: { productId: item.productId, branchId } },
      });
      const unitCost = item.unitCost != null ? Number(item.unitCost) : inventory.averageCost || 0;

      await deductBatchesFifo(tx, { inventoryId: inventory.id, productId: item.productId, quantity: qty });

      const previousStock = inventory.currentStock;
      const newStock = previousStock - qty;

      const updatedInventory = await tx.inventory.update({
        where: { productId_branchId: { productId: item.productId, branchId } },
        data: {
          currentStock: newStock,
          // reservedStock is untouched — supplier returns draw from
          // available (non-reserved) stock only, enforced by the
          // availableUnits() check above.
          totalValue: newStock * (inventory.averageCost || 0),
          lowStockAlert: newStock <= inventory.reorderPoint,
          excessStockAlert: newStock >= inventory.maximumStock,
        },
      });

      itemRows.push({ productId: item.productId, quantity: qty, unitCost, total: qty * unitCost });
      subtotal += qty * unitCost;

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          branchId,
          movementType: 'RETURN_OUT',
          quantity: -qty,
          previousStock,
          newStock: updatedInventory.currentStock,
          unitCost,
          totalCost: qty * unitCost,
          referenceType: 'SUPPLIER_RETURN',
          userId,
        },
      });
    }

    const returnNumber = await nextSequentialNumber(tx, {
      model: 'supplierReturn',
      field: 'returnNumber',
      prefix: 'SRET',
    });

    return tx.supplierReturn.create({
      data: {
        returnNumber,
        supplierId,
        branchId,
        status: 'COMPLETED',
        reason: reason || null,
        subtotal,
        createdBy: userId || null,
        items: { create: itemRows },
      },
      include: { items: { include: { product: { select: { id: true, name: true, sku: true } } } }, supplier: true },
    });
  });
}

module.exports = { createSupplierReturn };
