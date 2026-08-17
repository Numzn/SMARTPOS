import { useCallback, useEffect, useState } from 'react';
import { shiftApi } from '../services/shiftService';

/**
 * The single implementation of "how a shift starts" — a cashier landing on
 * the till screen with no active shift gets one automatically (INITIALIZING)
 * instead of clicking a manual "Open Shift" button; they then confirm their
 * physically-counted opening cash to complete INITIALIZING -> OPEN. This is
 * a different lifecycle transition from useEndShiftFlow (which owns
 * OPEN -> PENDING_RECONCILIATION and must stay untouched) — two hooks, each
 * the sole owner of its own transition, not two competing implementations of
 * the same one.
 *
 * Race-safety against double-shift creation (page refresh, two tabs, a
 * retried request) is enforced server-side by a DB-level constraint, not by
 * anything in this hook — see ensureShiftForLogin in lib/shift.js.
 */
export function useShiftInitialization({ enabled = true } = {}) {
  const [shift, setShift] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  const ensure = useCallback(async () => {
    if (!enabled) {
      setShift(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await shiftApi.ensureShift();
      setShift(result);
    } catch (err) {
      setError(err?.data?.error || err.message || 'Failed to start shift');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    ensure();
  }, [ensure]);

  const confirmOpening = useCallback(
    async ({ openingFloat, notes }) => {
      if (!shift) return;
      setConfirming(true);
      setError('');
      try {
        const updated = await shiftApi.confirmOpeningCash(shift.id, { openingFloat, notes });
        setShift(updated);
      } catch (err) {
        setError(err?.data?.error || err.message || 'Failed to confirm opening cash');
      } finally {
        setConfirming(false);
      }
    },
    [shift]
  );

  return { shift, loading, confirming, error, confirmOpening, refresh: ensure };
}
