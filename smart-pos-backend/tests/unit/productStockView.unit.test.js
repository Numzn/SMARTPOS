import { describe, it, expect } from 'vitest';
import productStockView from '../../lib/productStockView.js';
import inventoryStock from '../../lib/inventoryStock.js';

const { resolveProductStock, DEFAULT_BRANCH } = productStockView;
const { availableUnits } = inventoryStock;

function productWith(currentStock, reservedStock) {
  return {
    minStockLevel: 0,
    inventory: [{ branchId: DEFAULT_BRANCH, currentStock, reservedStock }],
    InventoryItem: [],
  };
}

describe('resolveProductStock', () => {
  it('REGRESSION: sellable stock excludes reservations, matching what checkout enforces', () => {
    // The reported bug: the grid showed 12 for a product with 9 units reserved
    // by an in-flight sale, so a cashier could add 10 to the cart and only then
    // be told "requested 10, available 3".
    const product = productWith(12, 9);
    const view = resolveProductStock(product);

    expect(view.stock).toBe(3);
    expect(view.availableStock).toBe(3);
    // On-hand is still reported for the inventory screens.
    expect(view.currentStock).toBe(12);
    expect(view.reservedStock).toBe(9);
  });

  it('agrees with availableUnits() for every combination — one definition, two call sites', () => {
    const cases = [
      [0, 0], [10, 0], [10, 10], [12, 9], [5, 7], [100, 1],
    ];
    for (const [current, reserved] of cases) {
      const view = resolveProductStock(productWith(current, reserved));
      const expected = availableUnits({ currentStock: current, reservedStock: reserved });
      expect(view.stock).toBe(expected);
    }
  });

  it('never reports negative stock when reservations exceed the count', () => {
    const view = resolveProductStock(productWith(5, 8));
    expect(view.stock).toBe(0);
    expect(view.availableStock).toBe(0);
  });

  it('low-stock alerting follows sellable stock, not the physical count', () => {
    // 12 on hand but 11 reserved: only 1 is actually sellable, so a reorder
    // threshold of 3 should be firing.
    const product = { ...productWith(12, 11), minStockLevel: 3 };
    expect(resolveProductStock(product).lowStockAlert).toBe(true);
  });

  it('treats a missing inventory row as zero rather than throwing', () => {
    const view = resolveProductStock({ inventory: [], InventoryItem: [] });
    expect(view.stock).toBe(0);
    expect(view.currentStock).toBe(0);
  });
});
