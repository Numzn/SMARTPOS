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
  const { hasPermission } = usePermissions();
  const canOperate = hasPermission('shifts:write'); // open/close own till
  const canOversee = hasPermission('shifts:read'); // see everyone's shifts

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [currentShift, setCurrentShift] = useState(null);
  const [currentReport, setCurrentReport] = useState(null);
  const [shifts, setShifts] = useState([]);

  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [movementType, setMovementType] = useState(null);
  const [historyReport, setHistoryReport] = useState(null);
  // Held after a close so the cashier actually sees their Z-report. Without
  // this the shift stops being "current" the moment it closes and the final
  // reconciliation would vanish off the screen — and a cashier without
  // shifts:read has no history table to find it in again.
  const [closedReport, setClosedReport] = useState(null);
  // Shift whose transaction journal is open, if any.
  const [journalShiftId, setJournalShiftId] = useState(null);

  const loadCurrent = useCallback(async () => {
    if (!canOperate) return null;
    const shift = await shiftApi.fetchCurrentShift();
    setCurrentShift(shift);
    if (shift) {
      setCurrentReport(await shiftApi.fetchShiftReport(shift.id));
    } else {
      setCurrentReport(null);
    }
    return shift;
  }, [canOperate]);

  const loadHistory = useCallback(async () => {
    if (!canOversee) return;
    setShifts(await shiftApi.fetchShifts());
  }, [canOversee]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadCurrent(), loadHistory()]);
    } catch (err) {
      setError(err?.data?.error || err.message || 'Failed to load cash register');
    } finally {
      setLoading(false);
    }
  }, [loadCurrent, loadHistory]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const runAction = async (fn, failureMessage) => {
    setSaving(true);
    try {
      await fn();
      await Promise.all([loadCurrent(), loadHistory()]);
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

  const handleCloseShift = ({ countedCash, notes }) =>
    runAction(async () => {
      const shiftId = currentShift.id;
      await shiftApi.closeShift(shiftId, { countedCash, notes });
      setShowCloseModal(false);
      // Fetch the Z-report before the shift stops being "current", and show
      // the server's own figures — the variance stored on close is computed
      // backend-side, so it is authoritative over the modal's preview.
      setClosedReport(await shiftApi.fetchShiftReport(shiftId));
    }, 'Error closing shift');

  const openHistoryReport = async (shift) => {
    try {
      setHistoryReport(await shiftApi.fetchShiftReport(shift.id));
    } catch (err) {
      alert(`Error loading shift report: ${err?.data?.error || err.message}`);
    }
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
        <p className="text-gray-600">Open and close the till, record cash movements, reconcile the drawer</p>
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
            <p className="text-sm text-green-800">
              Shift closed. Review the Z-report below — this is the final reconciliation.
            </p>
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

      {canOperate && (
        <section className="space-y-4">
          {!currentShift ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <p className="text-gray-600 mb-4">
                You don&apos;t have an open shift. Open the till to start recording sales against a
                cash drawer.
              </p>
              <button
                onClick={() => setShowOpenModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Open Shift
              </button>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700 mr-2">
                    OPEN
                  </span>
                  <span className="text-sm text-gray-600">
                    Expected in drawer:{' '}
                    <span className="font-semibold text-gray-900">
                      {money(currentReport?.cash?.expectedCash)}
                    </span>
                  </span>
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
                    onClick={() => setShowCloseModal(true)}
                    className="px-3 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700"
                  >
                    Close Shift
                  </button>
                </div>
              </div>

              <ShiftReportPanel report={currentReport} onViewTransactions={(s) => setJournalShiftId(s.id)} />
            </>
          )}
        </section>
      )}

      {canOversee && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Shift History</h2>
          <ShiftsTable shifts={shifts} onView={openHistoryReport} />
        </section>
      )}

      {!canOperate && !canOversee && (
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
        show={showCloseModal}
        onClose={() => setShowCloseModal(false)}
        loading={saving}
        onSubmit={handleCloseShift}
        expectedCash={currentReport?.cash?.expectedCash}
        breakdown={currentReport?.cash}
      />

      {historyReport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-end mb-2">
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
