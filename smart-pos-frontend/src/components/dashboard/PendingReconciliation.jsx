import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { shiftApi } from '../../services/shiftService';

/**
 * Supervisor's dashboard addition beyond Cashier's operational baseline —
 * how many shifts are waiting to be balanced. Links into Cash Register's
 * own reconciliation queue rather than duplicating the reconcile UI here.
 */
const PendingReconciliation = () => {
  const [count, setCount] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    shiftApi
      .fetchPendingReconciliation()
      .then((shifts) => {
        if (!cancelled) setCount(shifts.length);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="panel">
      <div className="panel-body flex items-center justify-between gap-3 py-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-gray-500" strokeWidth={1.5} />
          <span className="text-sm font-medium text-gray-900">Pending reconciliation</span>
        </div>
        <div className="flex items-center gap-3">
          {error ? (
            <span className="text-xs text-red-600">{error}</span>
          ) : (
            <span
              className={`text-sm font-semibold ${count > 0 ? 'text-amber-700' : 'text-gray-500'}`}
            >
              {count === null ? '…' : count}
            </span>
          )}
          <a href="/cash-register" className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
            Reconcile →
          </a>
        </div>
      </div>
    </div>
  );
};

export default PendingReconciliation;
