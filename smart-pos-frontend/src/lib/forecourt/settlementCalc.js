/**
 * Pure settlement math, no React/HTTP. Rounding/sign convention matches
 * components/shifts/VarianceBadge.jsx: Number(x.toFixed(2)), variance =
 * declared - expected (positive = over, negative = short).
 */
import { SETTLEMENT_STATUS } from './statuses';

const round2 = (n) => Number((Number(n) || 0).toFixed(2));

// "Still owed" means anything not fully SETTLED — mirrors the backend's
// computeUnsettledTotalsForAttendant (lib/forecourt/fuelTransaction.js),
// including its Phase-1 approximation that a PARTIALLY_SETTLED row's full
// amount is summed since no per-transaction remaining-balance field exists
// yet.
export function computeUnsettledTotal(transactions = []) {
  const unsettled = (transactions || []).filter((t) => t.settlementStatus !== SETTLEMENT_STATUS.SETTLED);
  const total = round2(unsettled.reduce((sum, t) => sum + Number(t.amount || 0), 0));
  return { count: unsettled.length, total };
}

const isBlank = (v) => v === '' || v == null;

export function computeVariance(expected, declared) {
  if (isBlank(expected) || isBlank(declared)) return null;
  return round2(Number(declared) - Number(expected));
}
