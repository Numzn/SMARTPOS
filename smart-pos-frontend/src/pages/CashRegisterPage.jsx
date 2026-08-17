import React, { useState, useEffect, useCallback } from 'react';
import ReconcileModal from '../components/shifts/ReconcileModal';
import AddAdjustmentModal from '../components/shifts/AddAdjustmentModal';
import VarianceBadge from '../components/shifts/VarianceBadge';
import ShiftReportPanel from '../components/shifts/ShiftReportPanel';
import ShiftsTable from '../components/shifts/ShiftsTable';
import ShiftTransactionJournal from '../components/shifts/ShiftTransactionJournal';
import { shiftApi } from '../services/shiftService';
import { usePermissions } from '../hooks/usePermissions';

/**
 * Back-office monitoring and reconciliation — Active Tills, Pending
 * Reconciliation, Shift History. Deliberately NOT where anyone operates
 * their own till: a shift starts automatically and is ended exclusively
 * from /cashier's Shift & Cash tools (see useShiftInitialization,
 * useEndShiftFlow) — this page only ever acts on shifts store-wide, never
 * "mine."
 */
const CashRegisterPage = () => {
  const { canAccess } = usePermissions();
  const canReconcile = canAccess.reconcileShift; // count + close ANY eligible shift, never own
  const canViewAll = canAccess.viewAllShifts; // full store-wide shift list
  const canReopen = canAccess.reopenShift; // also gates cancelling a stuck INITIALIZING shift
  const canAdjust = canAccess.adjustShift;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [pendingQueue, setPendingQueue] = useState([]);
  const [activeTills, setActiveTills] = useState([]);
  const [shifts, setShifts] = useState([]);

  const [reconcileTarget, setReconcileTarget] = useState(null); // { shift, zReport }
  const [historyReport, setHistoryReport] = useState(null);
  const [adjustTarget, setAdjustTarget] = useState(null); // { shift, variance }
  const [closedReport, setClosedReport] = useState(null);
  // Shift whose transaction journal is open, if any.
  const [journalShiftId, setJournalShiftId] = useState(null);

  const loadPendingQueue = useCallback(async () => {
    if (!canReconcile) return;
    setPendingQueue(await shiftApi.fetchPendingReconciliation());
  }, [canReconcile]);

  const loadActiveTills = useCallback(async () => {
    if (!canViewAll) return;
    setActiveTills(await shiftApi.fetchActiveTills());
  }, [canViewAll]);

  const loadHistory = useCallback(async () => {
    if (!canViewAll) return;
    setShifts(await shiftApi.fetchShifts());
  }, [canViewAll]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadPendingQueue(), loadActiveTills(), loadHistory()]);
    } catch (err) {
      setError(err?.data?.error || err.message || 'Failed to load cash register');
    } finally {
      setLoading(false);
    }
  }, [loadPendingQueue, loadActiveTills, loadHistory]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const runAction = async (fn, failureMessage) => {
    setSaving(true);
    try {
      await fn();
      await Promise.all([loadPendingQueue(), loadActiveTills(), loadHistory()]);
    } catch (err) {
      alert(`${failureMessage}: ${err?.data?.error || err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const openReconcileModal = async (shift) => {
    try {
      const zReport = await shiftApi.fetchZReport(shift.id);
      setReconcileTarget({ shift, zReport });
    } catch (err) {
      alert(`Error loading Z-report: ${err?.data?.error || err.message}`);
    }
  };

  const handleReconcile = ({ notes }) =>
    runAction(async () => {
      const shiftId = reconcileTarget.shift.id;
      await shiftApi.closeShift(shiftId, { notes });
      setReconcileTarget(null);
      setClosedReport(await shiftApi.fetchShiftReport(shiftId));
    }, 'Error reconciling shift');

  const handleAddAdjustment = ({ reason, resolutionNote }) =>
    runAction(async () => {
      await shiftApi.createAdjustment(adjustTarget.shift.id, { reason, resolutionNote });
      setAdjustTarget(null);
    }, 'Error adding adjustment');

  const openHistoryReport = async (shift) => {
    try {
      setHistoryReport(await shiftApi.fetchShiftReport(shift.id));
    } catch (err) {
      alert(`Error loading shift report: ${err?.data?.error || err.message}`);
    }
  };

  const handleReopen = async (shift) => {
    if (!window.confirm(`Reopen shift ${shift.shiftNumber || shift.id}? It returns to Pending Reconciliation.`)) return;
    await runAction(async () => {
      await shiftApi.reopenShift(shift.id);
      setHistoryReport(null);
    }, 'Error reopening shift');
  };

  // The escape hatch for a cashier stuck on the opening-cash prompt
  // (crash, abandoned browser, transferred branches) — without this,
  // the DB-level uniqueness that makes auto-shift-creation race-safe would
  // also permanently lock that user out of ever getting another shift.
  const handleCancelInitialization = async (shift) => {
    if (
      !window.confirm(
        `Cancel the stuck shift ${shift.shiftNumber} for ${shift.user?.name || 'this cashier'}? They'll get a fresh opening-cash prompt next time they open the till.`
      )
    ) {
      return;
    }
    await runAction(async () => {
      await shiftApi.cancelInitialization(shift.id);
    }, 'Error cancelling shift');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const awaitingDeclaration = pendingQueue.filter((s) => !s.hasDeclaration);
  const declaredAwaitingReview = pendingQueue.filter((s) => s.hasDeclaration);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Cash Register</h1>
        <p className="text-gray-600">Monitor active tills and reconcile shifts awaiting review</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">
          {error}
          <button onClick={loadAll} className="ml-3 underline">
            Retry
          </button>
        </div>
      )}

      {closedReport && (
        <section className="space-y-3">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between gap-3">
            <p className="text-sm text-green-800">Shift reconciled. Review the Z-report below.</p>
            <button
              onClick={() => setClosedReport(null)}
              className="px-3 py-1.5 border border-green-300 rounded-md text-sm font-medium text-green-800 hover:bg-green-100 shrink-0"
            >
              Dismiss
            </button>
          </div>
          <ShiftReportPanel report={closedReport} onViewTransactions={(s) => setJournalShiftId(s.id)} />
        </section>
      )}

      {canViewAll && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Active Tills</h2>
          {activeTills.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500 text-sm">
              No tills currently open.
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
              {activeTills.map((s) => {
                const isInitializing = s.status === 'INITIALIZING';
                return (
                  <div key={s.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {s.shiftNumber} · {s.user?.name || 'Unknown cashier'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {s.branchName || s.branchId} ·{' '}
                        {isInitializing
                          ? 'Awaiting opening-cash confirmation'
                          : `Opened ${s.openedAt ? new Date(s.openedAt).toLocaleString() : '—'}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          isInitializing ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {isInitializing ? 'INITIALIZING' : 'OPEN'}
                      </span>
                      {isInitializing && canReopen && (
                        <button
                          onClick={() => handleCancelInitialization(s)}
                          disabled={saving}
                          className="px-2 py-1 border border-red-300 rounded text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {canReconcile && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Pending Reconciliation</h2>

          <div>
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
              Declared — awaiting review ({declaredAwaitingReview.length})
            </h3>
            {declaredAwaitingReview.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-4 text-center text-gray-500 text-sm">
                Nothing declared yet.
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
                {declaredAwaitingReview.map((s) => (
                  <div key={s.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {s.shiftNumber} · {s.user?.name || 'Unknown cashier'}
                      </div>
                      <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                        Ended {s.endedAt ? new Date(s.endedAt).toLocaleString() : '—'}
                        {s.declaration?.variance != null && <VarianceBadge variance={s.declaration.variance} />}
                      </div>
                    </div>
                    <button
                      onClick={() => openReconcileModal(s)}
                      className="px-3 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
                    >
                      Reconcile
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
              Awaiting declaration ({awaitingDeclaration.length})
            </h3>
            {awaitingDeclaration.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-4 text-center text-gray-500 text-sm">
                Nothing waiting on a cashier's count.
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
                {awaitingDeclaration.map((s) => (
                  <div key={s.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-medium text-gray-900">
                      {s.shiftNumber} · {s.user?.name || 'Unknown cashier'}
                    </div>
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                      Awaiting cashier's count
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {canViewAll && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Shift History</h2>
          <ShiftsTable shifts={shifts} onView={openHistoryReport} />
        </section>
      )}

      {!canReconcile && !canViewAll && (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          You don&apos;t have permission to use the cash register.
        </div>
      )}

      <ReconcileModal
        show={!!reconcileTarget}
        onClose={() => setReconcileTarget(null)}
        loading={saving}
        onSubmit={handleReconcile}
        zReport={reconcileTarget?.zReport}
      />

      <AddAdjustmentModal
        show={!!adjustTarget}
        onClose={() => setAdjustTarget(null)}
        loading={saving}
        onSubmit={handleAddAdjustment}
        shiftLabel={adjustTarget?.shift?.shiftNumber || adjustTarget?.shift?.id}
        variance={adjustTarget?.variance}
      />

      {historyReport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-2">
            <div className="flex justify-end gap-2">
              {canAdjust && historyReport.shift?.status === 'CLOSED' && historyReport.cash?.variance ? (
                <button
                  onClick={() =>
                    setAdjustTarget({ shift: historyReport.shift, variance: historyReport.cash?.variance })
                  }
                  className="px-3 py-1.5 bg-white rounded-md text-sm font-medium text-indigo-700 border border-indigo-300 hover:bg-indigo-50"
                >
                  Add Adjustment
                </button>
              ) : null}
              {canReopen && historyReport.shift?.status === 'CLOSED' && (
                <button
                  onClick={() => handleReopen(historyReport.shift)}
                  className="px-3 py-1.5 bg-white rounded-md text-sm font-medium text-amber-700 border border-amber-300 hover:bg-amber-50"
                >
                  Reopen
                </button>
              )}
              <button
                onClick={() => setHistoryReport(null)}
                className="px-3 py-1.5 bg-white rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Close
              </button>
            </div>
            <ShiftReportPanel report={historyReport} onViewTransactions={(s) => setJournalShiftId(s.id)} />
          </div>
        </div>
      )}

      {journalShiftId && (
        <ShiftTransactionJournal
          shiftId={journalShiftId}
          onClose={() => setJournalShiftId(null)}
        />
      )}
    </div>
  );
};

export default CashRegisterPage;
