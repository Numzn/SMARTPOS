import { describe, it, expect } from 'vitest';
import { computeUnsettledTotal, computeVariance } from './settlementCalc';

describe('computeUnsettledTotal', () => {
  it('sums only UNSETTLED transactions', () => {
    const transactions = [
      { amount: 552.42, settlementStatus: 'UNSETTLED' },
      { amount: 752.99, settlementStatus: 'UNSETTLED' },
      { amount: 901.20, settlementStatus: 'SETTLED' },
    ];
    expect(computeUnsettledTotal(transactions)).toEqual({ count: 2, total: 1305.41 });
  });

  it('returns a zero total for an empty list', () => {
    expect(computeUnsettledTotal([])).toEqual({ count: 0, total: 0 });
    expect(computeUnsettledTotal()).toEqual({ count: 0, total: 0 });
  });

  it('does not throw on null', () => {
    expect(computeUnsettledTotal(null)).toEqual({ count: 0, total: 0 });
  });

  it('counts PARTIALLY_SETTLED and EXCEPTION as still owed, not just UNSETTLED', () => {
    const transactions = [
      { amount: 100, settlementStatus: 'PARTIALLY_SETTLED' },
      { amount: 200, settlementStatus: 'EXCEPTION' },
      { amount: 300, settlementStatus: 'UNSETTLED' },
      { amount: 400, settlementStatus: 'SETTLED' },
    ];
    expect(computeUnsettledTotal(transactions)).toEqual({ count: 3, total: 600 });
  });
});

describe('computeVariance', () => {
  it('is positive (over) when declared exceeds expected', () => {
    expect(computeVariance(100, 105.5)).toBe(5.5);
  });

  it('is negative (short) when declared is less than expected', () => {
    expect(computeVariance(100, 92)).toBe(-8);
  });

  it('returns null when either value is missing', () => {
    expect(computeVariance(null, 100)).toBeNull();
    expect(computeVariance(100, undefined)).toBeNull();
  });

  it('returns null (not a wrong number) when either value is a blank string', () => {
    expect(computeVariance(100, '')).toBeNull();
    expect(computeVariance('', 100)).toBeNull();
  });
});
