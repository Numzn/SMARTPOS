import { useCallback, useEffect, useState } from 'react';
import { shiftApi } from '../services/shiftService';

// Device-level, deliberately NOT keyed by userId — a till is a physical
// station; the next cashier logging in on the same machine should find the
// same register/till already resolved, not be asked to pick one again.
const RESOLVED_TILL_KEY = 'smartpos:resolvedTillId';

/**
 * V1 register/till model — the Cashier screen's real init flow, replacing
 * useShiftInitialization's login-triggered auto-shift for good (that hook
 * and OpeningCashPrompt are left completely intact, just no longer called
 * from here — see the comment on CashierDashboard's use of this hook).
 *
 * Requirement: cashier login/logout must never open or close a shift by
 * itself. This hook only ever reacts to explicit cashier actions
 * (openShift, handover) — nothing here runs automatically except read-only
 * resolution of what's already true.
 *
 * States:
 *   'loading'                 — resolving what to show
 *   'needsRegisterSelection'  — more than one register at this branch, none
 *                               remembered for this device yet
 *   'needsOpen'                — till resolved, no active shift on it
 *   'blockedOtherCashier'      — till resolved, active shift exists, but
 *                               someone else is the current cashier
 *   'ready'                    — operate normally (legacy shift, or this
 *                               user is the till's current cashier)
 *   'error'
 */
export function useRegisterShiftInit({ enabled = true } = {}) {
  const [state, setState] = useState('loading');
  const [registers, setRegisters] = useState([]);
  const [till, setTill] = useState(null);
  const [shift, setShift] = useState(null);
  const [currentCashier, setCurrentCashier] = useState(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [handingOver, setHandingOver] = useState(false);

  const resolve = useCallback(async () => {
    if (!enabled) {
      setState('ready');
      return;
    }
    setState('loading');
    setError('');
    try {
      // A shift the caller is already operating — a lingering legacy shift,
      // or a till-based one they're the current ShiftCashier on (e.g. they
      // reloaded, or just got handed one) — always wins outright, no till
      // resolution needed at all.
      const current = await shiftApi.fetchCurrentShift();
      if (current) {
        setShift(current);
        if (current.tillId) {
          const [registersData, cashier] = await Promise.all([
            shiftApi.fetchRegisters(),
            shiftApi.fetchCurrentCashier(current.id),
          ]);
          setRegisters(registersData);
          setCurrentCashier(cashier);
          const owningTill = registersData.flatMap((r) => r.tills).find((t) => t.id === current.tillId);
          if (owningTill) {
            setTill(owningTill);
            localStorage.setItem(RESOLVED_TILL_KEY, owningTill.id);
          }
        } else {
          setCurrentCashier(null);
        }
        setState('ready');
        return;
      }

      const registersData = await shiftApi.fetchRegisters();
      setRegisters(registersData);
      const allTills = registersData.flatMap((r) => r.tills.map((t) => ({ ...t, registerCode: r.code })));

      const storedTillId = localStorage.getItem(RESOLVED_TILL_KEY);
      let resolvedTill = storedTillId ? allTills.find((t) => t.id === storedTillId) : null;

      if (!resolvedTill && allTills.length === 1) {
        resolvedTill = allTills[0];
      }

      if (!resolvedTill) {
        setState(allTills.length === 0 ? 'error' : 'needsRegisterSelection');
        if (allTills.length === 0) setError('No registers/tills are configured for this branch yet.');
        return;
      }

      setTill(resolvedTill);
      localStorage.setItem(RESOLVED_TILL_KEY, resolvedTill.id);

      const activeShift = await shiftApi.fetchShiftForTill(resolvedTill.id);
      if (!activeShift) {
        setShift(null);
        setCurrentCashier(null);
        setState('needsOpen');
        return;
      }

      setShift(activeShift);
      const cashier = await shiftApi.fetchCurrentCashier(activeShift.id);
      setCurrentCashier(cashier);
      // fetchCurrentShift() above already returns any shift where *this*
      // user is the current ShiftCashier (or the legacy opener) — reaching
      // here with an active till shift therefore always means someone else
      // is operating it, whether or not their ShiftCashier row resolves.
      setState('blockedOtherCashier');
    } catch (err) {
      setError(err?.data?.error || err.message || 'Failed to resolve register/till');
      setState('error');
    }
  }, [enabled]);

  useEffect(() => {
    resolve();
  }, [resolve]);

  const selectTill = useCallback((selected) => {
    localStorage.setItem(RESOLVED_TILL_KEY, selected.id);
    setTill(selected);
    resolve();
  }, [resolve]);

  const forgetTill = useCallback(() => {
    localStorage.removeItem(RESOLVED_TILL_KEY);
    setTill(null);
    setState('needsRegisterSelection');
  }, []);

  const openShift = useCallback(
    async ({ declaredOpeningCash, notes }) => {
      if (!till) return;
      setOpening(true);
      setError('');
      try {
        const opened = await shiftApi.openShiftForTill({ tillId: till.id, declaredOpeningCash, notes });
        setShift(opened);
        setState('ready');
      } catch (err) {
        setError(err?.data?.error || err.message || 'Failed to open shift');
      } finally {
        setOpening(false);
      }
    },
    [till]
  );

  const handOver = useCallback(
    async ({ toUserId, declaredTotal, notes }) => {
      if (!shift) return null;
      setHandingOver(true);
      setError('');
      try {
        const result = await shiftApi.handoverShift(shift.id, { toUserId, declaredTotal, note: notes });
        return result;
      } catch (err) {
        setError(err?.data?.error || err.message || 'Failed to hand over shift');
        return null;
      } finally {
        setHandingOver(false);
      }
    },
    [shift]
  );

  return {
    state,
    registers,
    till,
    shift,
    currentCashier,
    error,
    opening,
    handingOver,
    selectTill,
    forgetTill,
    openShift,
    handOver,
    refresh: resolve,
  };
}
