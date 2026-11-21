import React, { useState, useEffect, useMemo } from 'react';
import { forecourtApi } from '../../services/forecourtService';
import { computeUnsettledTotal } from '../../lib/forecourt/settlementCalc';
import { usePermissions } from '../../hooks/usePermissions';
import AttendantBoard from './AttendantBoard';
import AttendantTransactionList from './AttendantTransactionList';
import ClearingReviewModal from './ClearingReviewModal';

const round2 = (n) => Number((Number(n) || 0).toFixed(2));

/**
 * Attendant Clearing — the primary Forecourt workflow (attendants with
 * unsettled sales, not a generic sales browser). Phase 2: UI with real
 * Phase 1 data (GET /api/forecourt/transactions), but the CLEAR action has
 * no backend endpoint yet — clearing is a local, in-memory optimistic
 * update only (see handleConfirmClearing), lost on refresh/tab-switch by
 * design, since AttendantSettlement/SettlementBatch are schema-only until
 * a later phase.
 *
 * Only one fetch is needed: FuelTransaction rows already include their
 * attendant (see lib/forecourt/fuelTransaction.js's listFuelTransactions),
 * so the attendant board is derived by grouping transactions, not a
 * separate GET /attendants call.
 */
const ForecourtPanel = ({ active }) => {
  const { canAccess } = usePermissions();

  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [selectedAttendantId, setSelectedAttendantId] = useState(null);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState(new Set());
  const [checkedAttendantIds, setCheckedAttendantIds] = useState(new Set());
  const [reviewIds, setReviewIds] = useState(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    forecourtApi
      .fetchTransactions()
      .then((rows) => {
        if (!cancelled) setTransactions(rows || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.data?.error || err.message || 'Failed to load forecourt data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const attendantSummaries = useMemo(() => {
    const byAttendant = new Map();
    for (const t of transactions) {
      if (t.settlementStatus === 'SETTLED') continue;
      if (!byAttendant.has(t.attendantId)) {
        byAttendant.set(t.attendantId, { ...t.attendant, transactions: [] });
      }
      byAttendant.get(t.attendantId).transactions.push(t);
    }
    return Array.from(byAttendant.values()).map((a) => {
      const { count, total } = computeUnsettledTotal(a.transactions);
      return { ...a, unsettledCount: count, unsettledTotal: total };
    });
  }, [transactions]);

  const selectedAttendant = attendantSummaries.find((a) => a.id === selectedAttendantId) || null;

  const reviewData = useMemo(() => {
    if (!reviewIds) return null;
    const txns = transactions.filter((t) => reviewIds.includes(t.id));
    const byAttendant = new Map();
    for (const t of txns) {
      if (!byAttendant.has(t.attendantId)) {
        byAttendant.set(t.attendantId, { attendant: t.attendant, count: 0, total: 0 });
      }
      const entry = byAttendant.get(t.attendantId);
      entry.count += 1;
      entry.total = round2(entry.total + Number(t.amount || 0));
    }
    return {
      count: txns.length,
      total: round2(txns.reduce((sum, t) => sum + Number(t.amount || 0), 0)),
      attendantBreakdown: Array.from(byAttendant.values()),
    };
  }, [reviewIds, transactions]);

  const handleSelectAttendant = (id) => {
    setSelectedAttendantId(id);
    setSelectedTransactionIds(new Set());
  };

  const handleBack = () => {
    setSelectedAttendantId(null);
    setSelectedTransactionIds(new Set());
  };

  const handleToggleAttendantCheck = (id) => {
    setCheckedAttendantIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleTransaction = (id) => {
    setSelectedTransactionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllTransactions = (selectAll) => {
    if (!selectedAttendant) return;
    setSelectedTransactionIds(selectAll ? new Set(selectedAttendant.transactions.map((t) => t.id)) : new Set());
  };

  const handleQuickClear = (attendant) => {
    setReviewIds(attendant.transactions.map((t) => t.id));
  };

  const handleClearSelected = () => {
    setReviewIds(Array.from(selectedTransactionIds));
  };

  const handleClearAll = () => {
    if (!selectedAttendant) return;
    setReviewIds(selectedAttendant.transactions.map((t) => t.id));
  };

  const handleReviewCombined = () => {
    const ids = attendantSummaries
      .filter((a) => checkedAttendantIds.has(a.id))
      .flatMap((a) => a.transactions.map((t) => t.id));
    setReviewIds(ids);
  };

  const handleConfirmClearing = () => {
    const clearedIds = new Set(reviewIds || []);
    setTransactions((prev) => prev.map((t) => (clearedIds.has(t.id) ? { ...t, settlementStatus: 'SETTLED' } : t)));
    setSelectedTransactionIds(new Set());
    setCheckedAttendantIds(new Set());
    setReviewIds(null);
  };

  if (!canAccess.viewForecourt) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Forecourt</h3>
          <p className="text-gray-500">You don&apos;t have permission to view forecourt data.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm p-6">
      <h3 className="text-lg font-medium text-gray-900 mb-1">Attendant Clearing</h3>
      <p className="text-sm text-gray-500 mb-5">Attendants with unsettled fuel sales, ready to clear.</p>

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : error ? (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>
      ) : selectedAttendant ? (
        <AttendantTransactionList
          attendant={selectedAttendant}
          onBack={handleBack}
          selectedIds={selectedTransactionIds}
          onToggleSelect={handleToggleTransaction}
          onSelectAll={handleSelectAllTransactions}
          onClearSelected={handleClearSelected}
          onClearAll={handleClearAll}
          canSettle={canAccess.settleForecourt}
        />
      ) : (
        <AttendantBoard
          attendants={attendantSummaries}
          search={search}
          onSearchChange={setSearch}
          checkedIds={checkedAttendantIds}
          onToggleCheck={handleToggleAttendantCheck}
          onSelectAttendant={handleSelectAttendant}
          onQuickClear={handleQuickClear}
          onReviewCombined={handleReviewCombined}
          canSettle={canAccess.settleForecourt}
        />
      )}

      <ClearingReviewModal
        open={!!reviewIds}
        onClose={() => setReviewIds(null)}
        onSubmit={handleConfirmClearing}
        reviewData={reviewData}
      />
    </div>
  );
};

export default ForecourtPanel;
