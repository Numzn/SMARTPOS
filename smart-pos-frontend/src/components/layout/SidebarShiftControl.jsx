import { Wallet } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import { useEndShiftFlow } from '../../hooks/useEndShiftFlow';
import SupervisorApprovalModal from '../cashier/modern/SupervisorApprovalModal';

/**
 * Always-reachable "End Shift" control for whoever opened the till
 * (shifts:operate — Supervisor/Manager/Admin), so ending a shift doesn't
 * require navigating into Cash Register first. Self-contained: fetches its
 * own current-shift state via useEndShiftFlow rather than depending on
 * CashRegisterPage's local state, so it works from anywhere in the app.
 *
 * This is one of two places a Cashier can initiate End Shift — the other is
 * CashierDashboard's header, the actual POS screen (see
 * CashierHeader.jsx/CashierDashboard.jsx). Both use useEndShiftFlow, so
 * there is exactly one implementation of the workflow, not two.
 *
 * `refreshKey` (MainLayout passes the route pathname) re-fetches on
 * navigation, so it picks up a shift opened/closed on the Cash Register page
 * without polling.
 */
const SidebarShiftControl = ({ refreshKey }) => {
  const { canAccess } = usePermissions();
  const { shift, loading, ending, modalOpen, error, requestEndShift, closeModal, handleApproved } =
    useEndShiftFlow({ enabled: canAccess.operateShift, refreshKey });

  if (!canAccess.operateShift || loading || !shift || shift.status !== 'OPEN') {
    return null;
  }

  return (
    <div className="px-3 py-2.5 border-t border-white/10">
      <div className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-widest mb-1.5">
        <Wallet className="w-3 h-3" strokeWidth={1.75} />
        Your shift
      </div>
      <div className="text-xs text-gray-300 truncate mb-2">{shift.shiftNumber || shift.id}</div>
      {error && <div className="text-[10px] text-red-400 mb-1.5">{error}</div>}
      <button
        type="button"
        onClick={requestEndShift}
        disabled={ending}
        className="w-full px-2.5 py-1.5 bg-amber-600/90 hover:bg-amber-600 text-white text-xs font-medium rounded disabled:opacity-50"
      >
        {ending ? 'Ending…' : 'End Shift'}
      </button>

      <SupervisorApprovalModal
        open={modalOpen}
        onClose={closeModal}
        actionType="SHIFT_END"
        target={{ shiftId: shift.id }}
        itemLabel={`Shift ${shift.shiftNumber || shift.id}`}
        onApproved={handleApproved}
      />
    </div>
  );
};

export default SidebarShiftControl;
