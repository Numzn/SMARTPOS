/**
 * Resolve display stock from inventory.currentStock (single source of truth for UIs).
 */

const DEFAULT_BRANCH = 'main';

function resolveProductStock(product, branchId = DEFAULT_BRANCH) {
  const inventoryRow = (product.inventory || []).find((inv) => inv.branchId === branchId);
  const currentStock = inventoryRow?.currentStock ?? 0;

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
    totalQuantity: currentStock,
    stock: currentStock,
    lowStockAlert: currentStock <= (product.minStockLevel || 0),
    hasExpiredItems,
    hasNearExpiryItems,
  };
}

module.exports = {
  DEFAULT_BRANCH,
  resolveProductStock,
};
