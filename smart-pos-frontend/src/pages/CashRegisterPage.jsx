import React, { useState, useEffect, useCallback } from 'react';
import OpenShiftModal from '../components/shifts/OpenShiftModal';
import CashMovementModal from '../components/shifts/CashMovementModal';
import ReconcileModal from '../components/shifts/ReconcileModal';
import SubmitDeclarationModal from '../components/shifts/SubmitDeclarationModal';
import AddAdjustmentModal from '../components/shifts/AddAdjustmentModal';
import VarianceBadge from '../components/shifts/VarianceBadge';
import ShiftReportPanel from '../components/shifts/ShiftReportPanel';
import ShiftsTable from '../components/shifts/ShiftsTable';
import ShiftTransactionJournal from '../components/shifts/ShiftTransactionJournal';
import SupervisorApprovalModal from '../components/cashier/modern/SupervisorApprovalModal';
import { shiftApi } from '../services/shiftService';
import { usePermissions } from '../hooks/usePermissions';
import { useEndShiftFlow } from '../hooks/useEndShiftFlow';

const money = (n) => `K${Number(n || 0).toFixed(2)}`;

const CashRegisterPage = () => {
  const { canAccess } = usePermissions();
  const canOperate = canAccess.operateShift; // open/end own till, cash movements
  const canRecordOnly = !canOperate && canAccess.recordCashMovement; // Cashier variant: cash movements on the branch's active till, never open/end
  const canRecordMovements = canOperate || canRecordOnly;
  const canReconcile = canAccess.reconcileShift; // count + close ANY eligible shift, never own
  const canViewAll = canAccess.viewAllShifts; // full store-wide shift list
  const canReopen = canAccess.reopenShift;
  const canAdjust = canAccess.adjustShift;

  // The single shared End Shift workflow — same hook SidebarShiftControl and
  // CashierDashboard use, so there is exactly one implementation of "how a
  // shift gets ended," not a third copy on this page.
  const endShiftFlow = useEndShiftFlow({ enabled: canOperate });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [currentReport, setCurrentReport] = useState(null);
  const [pendingQueue, setPendingQueue] = useState([]);
  const [activeTills, setActiveTills] = useState([]);
  const [shifts, setShifts] = useState([]);

  const [showOpenModal, setShowOpenModal] = useState(false);
  const [movementType, setMovementType] = useState(null);
  const [reconcileTarget, setReconcileTarget] = useState(null); // { shift, zReport }
  const [historyReport, setHistoryReport] = useState(null);
  const [adjustTarget, setAdjustTarget] = useState(null); // { shift, variance }
  const [closedReport, setClosedReport] = useState(null);
  // Shift whose transaction journal is open, if any.
  const [journalShiftId, setJournalShiftId] = useState(null);

  const currentShift = endShiftFlow.shift;

  const loadCurrentReport = useCallback(async () => {
    if (!canRecordMovements) return;
    if (endShiftFlow.shift) {
      setCurrentReport(await shiftApi.fetchShiftReport(endShiftFlow.shift.id));
    } else {
      setCurrentReport(null);
    }
  }, [canRecordMovements, endShiftFlow.shift]);

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
      await Promise.all([loadCurrentReport(), loadPendingQueue(), loadActiveTills(), loadHistory()]);
    } catch (err) {
      setError(err?.data?.error || err.message || 'Failed to load cash register');
    } finally {
      setLoading(false);
    }
  }, [loadCurrentReport, loadPendingQueue, loadActiveTills, loadHistory]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Once endShiftFlow ends the shift, currentShift/currentReport need a
  // refresh too (they're this page's own view of the same underlying data).
  useEffect(() => {
    if (endShiftFlow.lastEndedShiftId) {
      loadCurrentReport();
      loadPendingQueue();
    }
  }, [endShiftFlow.lastEndedShiftId, loadCurrentReport, loadPendingQueue]);

  const runAction = async (fn, failureMessage) => {
    setSaving(true);
    try {
      await fn();
      await Promise.all([loadCurrentReport(), loadPendingQueue(), loadActiveTills(), loadHistory()]);
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
      await endShiftFlow.refresh();
    }, 'Error opening shift');

  const handleCashMovement = ({ amount, reason }) =>
    runAction(async () => {
      if (movementType === 'SAFE_DROP') {
        await shiftApi.recordSafeDrop(currentShift.id, { amount, reason });
      } else {
        await shiftApi.recordCashMovement(currentShift.id, movementType, { amount, reason });
      }
      setMovementType(null);
    }, 'Error recording cash movement');

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

  const handleSubmitDeclaration = ({ declaredTotal }) =>
    runAction(async () => {
      await shiftApi.submitDeclaration(endShiftFlow.lastEndedShiftId, { declaredTotal });
      endShiftFlow.dismissEndedNotice();
    }, 'Error submitting declaration');

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

      {/* Just ended a shift on this page — Z is frozen, no financial figures
          shown, only the confirmation and an immediate path to declare. This
          is the one moment this operator can address their own ended shift:
          GET /shifts/current only returns OPEN shifts, and a plain
          shifts:operate holder has no permission to list PENDING_RECONCILIATION
          shifts to find it again later. */}
      {endShiftFlow.lastEndedShiftId && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-amber-900">
            Shift sealed — {endShiftFlow.lastZNumber || 'Z-report'} generated. Count the drawer and submit your
            declaration when ready.
          </p>
          <button
            onClick={endShiftFlow.dismissEndedNotice}
            className="px-3 py-1.5 border border-amber-300 rounded-md text-sm font-medium text-amber-800 hover:bg-amber-100 shrink-0"
          >
            Submit later / dismiss
          </button>
        </div>
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
                  <button
                    onClick={() => setMovementType('SAFE_DROP')}
                    className="px-3 py-2 border border-indigo-300 rounded-md text-sm font-medium text-indigo-700 hover:bg-indigo-50"
                  >
                    Safe Drop
                  </button>
                  {/* Ending a shift is PIN-gated, not permission-gated — any
                      shifts:operate holder can request it, a Supervisor+
                      (never the same person) authorizes it. */}
                  {canOperate && (
                    <button
                      onClick={endShiftFlow.requestEndShift}
                      disabled={endShiftFlow.ending}
                      className="px-3 py-2 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
                    >
                      {endShiftFlow.ending ? 'Ending…' : 'End Shift'}
                    </button>
                  )}
                </div>
              </div>
              {endShiftFlow.error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
                  {endShiftFlow.error}
                </div>
              )}

              <ShiftReportPanel report={currentReport} onViewTransactions={(s) => setJournalShiftId(s.id)} />
            </>
          )}
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
              {activeTills.map((s) => (
                <div key={s.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {s.shiftNumber} · {s.user?.name || 'Unknown cashier'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {s.branchName || s.branchId} · Opened {s.openedAt ? new Date(s.openedAt).toLocaleString() : '—'}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">OPEN</span>
                </div>
              ))}
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

      <SupervisorApprovalModal
        open={endShiftFlow.modalOpen}
        onClose={endShiftFlow.closeModal}
        actionType="SHIFT_END"
        target={currentShift ? { shiftId: currentShift.id } : undefined}
        itemLabel={currentShift ? `Shift ${currentShift.shiftNumber || currentShift.id}` : undefined}
        onApproved={endShiftFlow.handleApproved}
      />

      <SubmitDeclarationModal
        show={!!endShiftFlow.lastEndedShiftId}
        shiftLabel={endShiftFlow.lastZNumber}
        onClose={endShiftFlow.dismissEndedNotice}
        loading={saving}
        onSubmit={handleSubmitDeclaration}
      />

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
