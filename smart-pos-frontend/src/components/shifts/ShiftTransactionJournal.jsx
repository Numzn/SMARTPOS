import React, { useState, useEffect, useCallback } from 'react';
import { shiftApi } from '../../services/shiftService';
import { exportShiftJournalPdf, exportShiftJournalCsv } from '../../lib/shiftPdf';

const money = (n) => `K${Number(n || 0).toFixed(2)}`;

const formatTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const TYPE_STYLES = {
  SALE: 'bg-green-100 text-green-700',
  REFUND: 'bg-orange-100 text-orange-700',
  CANCELLED: 'bg-red-100 text-red-700',
  CASH_IN: 'bg-blue-100 text-blue-700',
  CASH_OUT: 'bg-purple-100 text-purple-700',
  PAID_OUT: 'bg-yellow-100 text-yellow-700',
};

// Only the types this data model actually produces. There is no suspended
// state and no void distinct from CANCELLED, so neither is offered as a
// filter that could never match anything.
const TYPE_FILTERS = [
  { value: '', label: 'All types' },
  { value: 'SALE', label: 'Sales' },
  { value: 'REFUND', label: 'Refunds' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'CASH_IN,CASH_OUT,PAID_OUT', label: 'Cash movements' },
];

/**
 * Full-page drill-down listing every event in a shift. Reached from
 * "View Transactions" on either the X or Z report.
 */
const ShiftTransactionJournal = ({ shiftId, onClose }) => {
  const [journal, setJournal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState('time_desc');

  const load = useCallback(async (params) => {
    setLoading(true);
    setError(null);
    try {
      setJournal(await shiftApi.fetchShiftTransactions(shiftId, params));
    } catch (err) {
      setError(err?.data?.error || err.message || 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [shiftId]);

  useEffect(() => {
    load({ sort });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId]);

  // Debounce the search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => load({ search, type, sort }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, type, sort]);

  const summary = journal?.summary || {};
  const rows = journal?.transactions || [];

  return (
    <div className="fixed inset-0 bg-white z-50 overflow-y-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Shift Transaction Journal</h1>
            <p className="text-sm text-gray-500">
              {journal?.shift?.shiftNumber || shiftId} · {journal?.shift?.status} ·{' '}
              {summary.total ?? 0} transaction{summary.total === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => journal && exportShiftJournalCsv(journal)}
              disabled={!journal}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Export CSV
            </button>
            <button
              onClick={() => journal && exportShiftJournalPdf(journal)}
              disabled={!journal}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Export PDF
            </button>
            <button
              onClick={() => window.print()}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Print
            </button>
            <button
              onClick={onClose}
              className="px-3 py-2 bg-gray-800 text-white rounded-md text-sm font-medium hover:bg-gray-900"
            >
              Back to Report
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Sales', value: summary.sales ?? 0 },
            { label: 'Refunds', value: summary.refunds ?? 0 },
            { label: 'Cancelled', value: summary.cancelled ?? 0 },
            { label: 'Cash Movements', value: summary.cashMovements ?? 0 },
          ].map((t) => (
            <div key={t.label} className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-medium text-gray-600">{t.label}</p>
              <p className="text-xl font-bold text-gray-900">{t.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Receipt, invoice, customer, cashier, reason…"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              {TYPE_FILTERS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sort</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="time_desc">Newest first</option>
              <option value="time_asc">Oldest first</option>
              <option value="total_desc">Highest amount</option>
              <option value="total_asc">Lowest amount</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="bg-white border border-gray-200 rounded-lg p-10 text-center text-gray-500">
            Loading transactions…
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-10 text-center text-gray-500">
            No transactions match these filters.
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Time', 'Invoice', 'Receipt', 'Type', 'Customer', 'Cashier', 'Payment', 'Total', 'Tax', 'Status'].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={`px-3 py-3 text-xs font-medium text-gray-500 uppercase ${
                          i >= 7 && i <= 8 ? 'text-right' : 'text-left'
                        }`}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((t) => (
                  <tr key={`${t.type}-${t.id}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm text-gray-600 whitespace-nowrap">{formatTime(t.time)}</td>
                    <td className="px-3 py-2 text-sm text-gray-600">{t.invoiceNumber || '—'}</td>
                    <td className="px-3 py-2 text-sm font-medium text-gray-900">{t.receiptNumber || '—'}</td>
                    <td className="px-3 py-2 text-sm">
                      <span className={`px-2 py-0.5 rounded text-xs ${TYPE_STYLES[t.type] || 'bg-gray-100 text-gray-700'}`}>
                        {t.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-600">{t.customer || '—'}</td>
                    <td className="px-3 py-2 text-sm text-gray-600">{t.cashier || '—'}</td>
                    <td className="px-3 py-2 text-sm text-gray-600">{t.paymentMethod || '—'}</td>
                    <td className={`px-3 py-2 text-sm text-right font-medium ${t.total < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                      {money(t.total)}
                    </td>
                    <td className="px-3 py-2 text-sm text-right text-gray-600">{money(t.tax)}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">
                      {t.status}
                      {t.note && <span className="block text-xs text-gray-400">{t.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShiftTransactionJournal;
