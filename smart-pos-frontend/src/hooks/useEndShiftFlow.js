import { useCallback, useEffect, useState } from 'react';
import { shiftApi } from '../services/shiftService';

/**
 * The single implementation of "how a shift gets ended" — used by
 * CashierDashboard's Shift & Cash tools section (the canonical place to end
 * a shift) and CashRegisterPage's own End Shift action. Each caller gets its
 * own independent fetch of the current shift, but the workflow itself —
 * opening the approval modal, calling endShift with the resulting
 * approvalId, surfacing errors — exists exactly once here, not copied
 * between UI locations.
 *
 * Deliberately exposes only a Z-number confirmation on success, never
 * financial figures — the cashier who just ended their shift never sees
 * expected cash or variance; that only exists for whoever reconciles it.
 */
export function useEndShiftFlow({ enabled = true, refreshKey } = {}) {
  const [shift, setShift] = useState(null);
  const [loading, setLoading] = useState(false);
  const [ending, setEnding] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState('');
  const [lastZNumber, setLastZNumber] = useState('');
  const [lastEndedShiftId, setLastEndedShiftId] = useState('');

  const refresh = useCallback(async () => {
    if (!enabled) {
      setShift(null);
      return;
    }
    setLoading(true);
    try {
      const current = await shiftApi.fetchCurrentShift();
      setShift(current);
    } catch {
      setShift(null);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const requestEndShift = useCallback(() => {
    if (!shift || shift.status !== 'OPEN') return;
    setError('');
    setLastZNumber('');
    setLastEndedShiftId('');
    setModalOpen(true);
  }, [shift]);

  const closeModal = useCallback(() => setModalOpen(false), []);

  const handleApproved = useCallback(
    async ({ approvalId }) => {
      if (!shift) return;
      const endedShiftId = shift.id;
      setModalOpen(false);
      setEnding(true);
      setError('');
      try {
        const result = await shiftApi.endShift(endedShiftId, { approvalId });
        setLastZNumber(result?.zNumber || '');
        // GET /shifts/current only ever returns an OPEN shift, so once this
        // ends there's no query permission model lets a Cashier use to find
        // it again later — this is the one moment it's addressable.
        setLastEndedShiftId(endedShiftId);
        await refresh();
      } catch (err) {
        setError(err?.data?.error || err.message || 'Failed to end shift');
      } finally {
        setEnding(false);
      }
    },
    [shift, refresh]
  );

  const dismissEndedNotice = useCallback(() => {
    setLastZNumber('');
    setLastEndedShiftId('');
  }, []);

  return {
    shift,
    loading,
    ending,
    modalOpen,
    error,
    lastZNumber,
    lastEndedShiftId,
    requestEndShift,
    closeModal,
    handleApproved,
    dismissEndedNotice,
    refresh,
  };
}
