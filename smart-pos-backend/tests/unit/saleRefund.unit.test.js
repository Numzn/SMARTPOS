import { describe, it, expect } from 'vitest';
import saleRefund from '../../lib/saleRefund.js';

const { prorateSaleDiscount, getOriginalInvcNo } = saleRefund;

describe('prorateSaleDiscount', () => {
  it('returns 0 when the original sale had no discount', () => {
    const sale = { discount: 0, subtotal: 100, saleItems: [] };
    expect(prorateSaleDiscount(sale, 50)).toBe(0);
  });

  it('returns 0 when the original subtotal is 0 (avoids divide-by-zero)', () => {
    const sale = { discount: 10, subtotal: 0, saleItems: [] };
    expect(prorateSaleDiscount(sale, 50)).toBe(0);
  });

  it('prorates the discount proportionally to the refunded subtotal', () => {
    // Original sale: subtotal 100, discount 20 (20%). Refunding half the subtotal
    // should only carry half the discount, not the full original discount.
    const sale = { discount: 20, subtotal: 100, saleItems: [] };
    expect(prorateSaleDiscount(sale, 50)).toBe(10);
  });

  it('caps the prorated discount at the full original discount (ratio clamped to 1)', () => {
    const sale = { discount: 20, subtotal: 100, saleItems: [] };
    // A refund subtotal larger than the original (shouldn't normally happen,
    // but the function must not hand back more discount than was ever given).
    expect(prorateSaleDiscount(sale, 150)).toBe(20);
  });

  it('falls back to computing subtotal from saleItems when sale.subtotal is absent', () => {
    const sale = {
      discount: 10,
      subtotal: null,
      saleItems: [
        { quantity: 2, price: 25 },
        { quantity: 1, price: 50 },
      ],
    };
    // Computed original subtotal = 100; refunding 50 => half the discount.
    expect(prorateSaleDiscount(sale, 50)).toBe(5);
  });
});

describe('getOriginalInvcNo', () => {
  it('returns 0 when the sale has no vsdcResponse', () => {
    expect(getOriginalInvcNo({ vsdcResponse: null })).toBe(0);
    expect(getOriginalInvcNo(null)).toBe(0);
  });

  it('reads invcNo from a flat vsdcResponse', () => {
    expect(getOriginalInvcNo({ vsdcResponse: { invcNo: 42 } })).toBe(42);
  });

  it('reads invcNo from a nested { data: {...} } vsdcResponse', () => {
    expect(getOriginalInvcNo({ vsdcResponse: { data: { invcNo: 7 } } })).toBe(7);
  });
});
