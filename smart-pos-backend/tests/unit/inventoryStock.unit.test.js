import { describe, it, expect } from 'vitest';
import inventoryStock from '../../lib/inventoryStock.js';

const { availableUnits } = inventoryStock;

describe('availableUnits', () => {
  it('subtracts reserved stock from current stock', () => {
    expect(availableUnits({ currentStock: 10, reservedStock: 3 })).toBe(7);
  });

  it('never goes negative even if reservedStock exceeds currentStock (drift protection)', () => {
    expect(availableUnits({ currentStock: 2, reservedStock: 5 })).toBe(0);
  });

  it('treats a missing inventory row as zero stock', () => {
    expect(availableUnits(null)).toBe(0);
    expect(availableUnits(undefined)).toBe(0);
  });

  it('treats missing currentStock/reservedStock fields as zero', () => {
    expect(availableUnits({})).toBe(0);
  });
});
