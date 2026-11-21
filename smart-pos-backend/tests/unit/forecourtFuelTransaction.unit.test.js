import { describe, it, expect } from 'vitest';
import { computeUnsettledTotalsForAttendant } from '../../lib/forecourt/fuelTransaction.js';

// Pure aggregation over plain-object fixtures shaped like FuelTransaction
// rows — no DB. The real Prisma-backed integration test lands once
// AttendantSettlement is implemented (later phase).
describe('lib/forecourt/fuelTransaction', () => {
  describe('computeUnsettledTotalsForAttendant', () => {
    it('sums only UNSETTLED transactions', () => {
      const transactions = [
        { amount: 552.42, settlementStatus: 'UNSETTLED' },
        { amount: 752.99, settlementStatus: 'UNSETTLED' },
        { amount: 901.20, settlementStatus: 'SETTLED' },
      ];
      expect(computeUnsettledTotalsForAttendant(transactions)).toEqual({ count: 2, total: 1305.41 });
    });

    it('returns a zero total for an empty or fully-settled list', () => {
      expect(computeUnsettledTotalsForAttendant([])).toEqual({ count: 0, total: 0 });
      expect(
        computeUnsettledTotalsForAttendant([{ amount: 100, settlementStatus: 'SETTLED' }])
      ).toEqual({ count: 0, total: 0 });
    });

    it('counts PARTIALLY_SETTLED and EXCEPTION as still owed, not just UNSETTLED', () => {
      const transactions = [
        { amount: 100, settlementStatus: 'PARTIALLY_SETTLED' },
        { amount: 200, settlementStatus: 'EXCEPTION' },
        { amount: 300, settlementStatus: 'UNSETTLED' },
        { amount: 400, settlementStatus: 'SETTLED' },
      ];
      expect(computeUnsettledTotalsForAttendant(transactions)).toEqual({ count: 3, total: 600 });
    });

    it('defaults gracefully when called with no argument', () => {
      expect(computeUnsettledTotalsForAttendant()).toEqual({ count: 0, total: 0 });
    });
  });
});
