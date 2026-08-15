import React, { useState, useEffect, useCallback } from 'react';
import OpenShiftModal from '../components/shifts/OpenShiftModal';
import CashMovementModal from '../components/shifts/CashMovementModal';
import CloseShiftModal from '../components/shifts/CloseShiftModal';
import ShiftReportPanel from '../components/shifts/ShiftReportPanel';
import ShiftsTable from '../components/shifts/ShiftsTable';
import ShiftTransactionJournal from '../components/shifts/ShiftTransactionJournal';
import { shiftApi } from '../services/shiftService';
import { usePermissions } from '../hooks/usePermissions';

const money = (n) => `K${Number(n || 0).toFixed(2)}`;

const CashRegisterPage = () => {
  const { canAccess } = usePermissions();
  const canOperate = canAccess.operateShift; // Supervisor+: open/end own till, cash movements
  const canRecordOnly = !canOperate && canAccess.recordCashMovement; // Cashier: cash movements on the branch's active till, never open/end
  const canRecordMovements = canOperate || canRecordOnly;
  const canReconcile = canAccess.reconcileShift; // count + close ANY eligible shift, never own
  const canViewAll = canAccess.viewAllShifts; // full store-wide shift list
  const canReopen = canAccess.reopenShift;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [currentShift, setCurrentShift] = useState(null);
  const [currentReport, setCurrentReport] = useState(null);
  const [pendingQueue, setPendingQueue] = useState([]);
  const [shifts, setShifts] = useState([]);

  const [showOpenModal, setShowOpenModal] = useState(false);
  const [movementType, setMovementType] = useState(null);
  const [reconcileTarget, setReconcileTarget] = useState(null); // { shift, report }
  const [historyReport, setHistoryReport] = useState(null);
  // Held after ending/reconciling so the operator actually sees the result.
  const [endedNotice, setEndedNotice] = useState(false);
  const [closedReport, setClosedReport] = useState(null);
  // Shift whose transaction journal is open, if any.
  const [journalShiftId, setJournalShiftId] = useState(null);

  const loadCurrent = useCallback(async () => {
    if (!canRecordMovements) return null;
    // Supervisor+ (canOperate): their own shift. Cashier (canRecordOnly):
    // the branch's currently active shift, whoever opened it — the backend
    // resolves which one this is.
    const shift = await shiftApi.fetchCurrentShift();
    setCurrentShift(shift);
    if (shift) {
      setCurrentReport(await shiftApi.fetchShiftReport(shift.id));
    } else {
      setCurrentReport(null);
    }
    return shift;
  }, [canRecordMovements]);

  const loadPendingQueue = useCallback(async () => {
    if (!canReconcile) return;
    setPendingQueue(await shiftApi.fetchPendingReconciliation());
  }, [canReconcile]);

  const loadHistory = useCallback(async () => {
    if (!canViewAll) return;
    setShifts(await shiftApi.fetchShifts());
  }, [canViewAll]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadCurrent(), loadPendingQueue(), loadHistory()]);
    } catch (err) {
      setError(err?.data?.error || err.message || 'Failed to load cash register');
    } finally {
      setLoading(false);
    }
  }, [loadCurrent, loadPendingQueue, loadHistory]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const runAction = async (fn, failureMessage) => {
    setSaving(true);
    try {
      await fn();
      await Promise.all([loadCurrent(), loadPendingQueue(), loadHistory()]);
    } catch (err) {
      alert(`${failureMessage}: ${err?.data?.error || err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenShift = ({ openingFloat, notes }) =>
    runAction(async () => {
      await shiftApi.openShift({ openingFloat, notes });
      setShowOpenModal(false);
    }, 'Error opening shift');

  const handleCashMovement = ({ amount, reason }) =>
    runAction(async () => {
      await shiftApi.recordCashMovement(currentShift.id, movementType, { amount, reason });
      setMovementType(null);
    }, 'Error recording cash movement');

  const handleEndShift = () =>
    runAction(async () => {
      await shiftApi.endShift(currentShift.id);
      setEndedNotice(true);
    }, 'Error ending shift');

  const openReconcileModal = async (shift) => {
    try {
      const report = await shiftApi.fetchShiftReport(shift.id);
      setReconcileTarget({ shift, report });
    } catch (err) {
      alert(`Error loading shift: ${err?.data?.error || err.message}`);
    }
  };

  const handleReconcile = ({ countedCash, notes }) =>
    runAction(async () => {
      const shiftId = reconcileTarget.shift.id;
      await shiftApi.closeShift(shiftId, { countedCash, notes });
      setReconcileTarget(null);
      setClosedReport(await shiftApi.fetchShiftReport(shiftId));
    }, 'Error reconciling shift');

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Cash Register</h1>
        <p className="text-gray-600">
          {canReconcile
            ? 'Operate your own till, and balance operators awaiting reconciliation'
            : canOperate
              ? 'Open and use your till, record cash movements, end your shift'
              : 'Record cash movements on the till currently in use'}
        </p>
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

      {canRecordMovements && (
        <section className="space-y-4">
          {!currentShift ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              {canOperate ? (
                <>
                  <p className="text-gray-600 mb-4">
                    You don&apos;t have an open shift. Open the till to start recording sales
                    against a cash drawer.
                  </p>
                  <button
                    onClick={() => setShowOpenModal(true)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Open Shift
                  </button>
                </>
              ) : (
                <p className="text-gray-600">
                  No till is open for this branch yet. Ask a supervisor or manager to open one
                  before you can record cash movements.
                </p>
              )}
            </div>
          ) : currentShift.status === 'PENDING_RECONCILIATION' ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
              <span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800 mr-2">
                AWAITING RECONCILIATION
              </span>
              <p className="text-sm text-amber-900 mt-3">
                {canOperate
                  ? "Your shift has ended and is locked. A supervisor or manager will count the drawer and close it — you can't reconcile your own till."
                  : 'This till has ended and is locked, awaiting a supervisor or manager to count the drawer and close it.'}
              </p>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700 mr-2">
                    OPEN
                  </span>
                  {canAccess.viewExpectedCash ? (
                    <span className="text-sm text-gray-600">
                      Expected in drawer:{' '}
                      <span className="font-semibold text-gray-900">
                        {money(currentReport?.cash?.expectedCash)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm text-gray-500">
                      {canOperate ? 'Till in use' : `Till in use${currentShift.user?.name ? ` — opened by ${currentShift.user.name}` : ''}`}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setMovementType('CASH_IN')}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cash In
                  </button>
                  <button
                    onClick={() => setMovementType('CASH_OUT')}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cash Out
                  </button>
                  <button
                    onClick={() => setMovementType('PAID_OUT')}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Paid Out
                  </button>
                  {/* Only Supervisor+ (canOperate) ends a shift — a Cashier
                      keeps cash movements but never opens or ends one. */}
                  {canOperate && (
                    <button
                      onClick={handleEndShift}
                      disabled={saving}
                      className="px-3 py-2 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
                    >
                      End Shift
                    </button>
                  )}
                </div>
              </div>

              <ShiftReportPanel report={currentReport} onViewTransactions={(s) => setJournalShiftId(s.id)} />
            </>
          )}
        </section>
      )}

      {canReconcile && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Pending Reconciliation</h2>
          {pendingQueue.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500 text-sm">
              No shifts waiting to be balanced.
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
              {pendingQueue.map((s) => (
                <div key={s.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {s.shiftNumber} · {s.user?.name || 'Unknown cashier'}
                    </div>
                    <div className="text-xs text-gray-500">
                      Ended {s.endedAt ? new Date(s.endedAt).toLocaleString() : '—'}
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
        </section>
      )}

      {canViewAll && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Shift History</h2>
          <ShiftsTable shifts={shifts} onView={openHistoryReport} />
        </section>
      )}

      {!canRecordMovements && !canReconcile && !canViewAll && (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          You don&apos;t have permission to use the cash register.
        </div>
      )}

      <OpenShiftModal
        show={showOpenModal}
        onClose={() => setShowOpenModal(false)}
        loading={saving}
        onSubmit={handleOpenShift}
      />

      <CashMovementModal
        show={!!movementType}
        type={movementType}
        onClose={() => setMovementType(null)}
        loading={saving}
        onSubmit={handleCashMovement}
      />

      <CloseShiftModal
        show={!!reconcileTarget}
        onClose={() => setReconcileTarget(null)}
        loading={saving}
        onSubmit={handleReconcile}
        expectedCash={reconcileTarget?.report?.cash?.expectedCash}
        breakdown={reconcileTarget?.report?.cash}
      />

      {endedNotice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm text-center space-y-3">
            <p className="text-gray-800 text-sm">
              Shift ended. It&apos;s now awaiting a supervisor or manager to count the drawer and
              close it.
            </p>
            <button
              onClick={() => setEndedNotice(false)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {historyReport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-2">
            <div className="flex justify-end gap-2">
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
