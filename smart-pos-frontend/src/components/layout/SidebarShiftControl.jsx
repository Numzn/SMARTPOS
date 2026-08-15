import { useCallback, useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import { shiftApi } from '../../services/shiftService';

/**
 * Always-reachable "End Shift" control for whoever opened the till
 * (shifts:operate — Supervisor/Manager/Admin), so ending a shift doesn't
 * require navigating into Cash Register first. Self-contained: fetches its
 * own current-shift state rather than depending on CashRegisterPage's local
 * state, so it works from anywhere in the app.
 *
 * `refreshKey` (MainLayout passes the route pathname) re-fetches on
 * navigation, so it picks up a shift opened/closed on the Cash Register page
 * without polling.
 */
const SidebarShiftControl = ({ refreshKey }) => {
  const { canAccess } = usePermissions();
  const [shift, setShift] = useState(null);
  const [loading, setLoading] = useState(false);
  const [ending, setEnding] = useState(false);

  const load = useCallback(async () => {
    if (!canAccess.operateShift) return;
    setLoading(true);
    try {
      const current = await shiftApi.fetchCurrentShift();
      setShift(current);
    } catch {
      setShift(null);
    } finally {
      setLoading(false);
    }
  }, [canAccess.operateShift]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!canAccess.operateShift || loading || !shift || shift.status !== 'OPEN') {
    return null;
  }

  const handleEnd = async () => {
    if (!window.confirm(`End shift ${shift.shiftNumber || shift.id}? It will lock and await reconciliation.`)) {
      return;
    }
    setEnding(true);
    try {
      await shiftApi.endShift(shift.id);
      await load();
    } catch (err) {
      alert(`Error ending shift: ${err?.data?.error || err.message}`);
    } finally {
      setEnding(false);
    }
  };

  return (
    <div className="px-3 py-2.5 border-t border-white/10">
      <div className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-widest mb-1.5">
        <Wallet className="w-3 h-3" strokeWidth={1.75} />
        Your shift
      </div>
      <div className="text-xs text-gray-300 truncate mb-2">{shift.shiftNumber || shift.id}</div>
      <button
        type="button"
        onClick={handleEnd}
        disabled={ending}
        className="w-full px-2.5 py-1.5 bg-amber-600/90 hover:bg-amber-600 text-white text-xs font-medium rounded disabled:opacity-50"
      >
        {ending ? 'Ending…' : 'End Shift'}
      </button>
    </div>
  );
};

export default SidebarShiftControl;
