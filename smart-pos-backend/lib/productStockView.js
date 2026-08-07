/**
 * Resolve display stock from inventory.currentStock (single source of truth for UIs).
 */

const DEFAULT_BRANCH = 'main';

function resolveProductStock(product, branchId = DEFAULT_BRANCH) {
  const inventoryRow = (product.inventory || []).find((inv) => inv.branchId === branchId);
  const currentStock = inventoryRow?.currentStock ?? 0;
  const reservedStock = inventoryRow?.reservedStock ?? 0;
  // Must match availableUnits() in lib/inventoryStock.js — that is what
  // checkout enforces, and `stock` below is what the cashier UI gates on.
  const availableStock = Math.max(0, currentStock - reservedStock);

  const batches = product.InventoryItem || [];
  const hasExpiredItems = batches.some(
    (item) => item.expiryDate && new Date(item.expiryDate) < new Date()
  );
  const hasNearExpiryItems = batches.some(
    (item) =>
      item.expiryDate &&
      new Date(item.expiryDate) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  );

  return {
    currentStock,
    reservedStock,
    availableStock,
    totalQuantity: currentStock,
    // `stock` is the sellable figure. It previously returned currentStock,
    // which ignored reservations: the cashier grid would offer 12 units while
    // checkout — using availableUnits() — rejected anything over 3, giving
    // "Insufficient stock: requested 10, available 3" against a screen that
    // clearly said 12. On-hand is still available as currentStock for the
    // inventory screens, where the physical count is the meaningful number.
    stock: availableStock,
    lowStockAlert: availableStock <= (product.minStockLevel || 0),
    hasExpiredItems,
    hasNearExpiryItems,
  };
}

module.exports = {
  DEFAULT_BRANCH,
  resolveProductStock,
};
