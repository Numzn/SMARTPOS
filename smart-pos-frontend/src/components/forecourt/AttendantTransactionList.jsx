import React from 'react';
import { FISCAL_STATUS } from '../../lib/forecourt/statuses';

const money = (n) => `K${Number(n || 0).toFixed(2)}`;

const FISCAL_BADGE = {
  [FISCAL_STATUS.FISCALIZED]: 'bg-emerald-100 text-emerald-700',
  [FISCAL_STATUS.SUMMARY_FISCALIZED]: 'bg-emerald-100 text-emerald-700',
  [FISCAL_STATUS.PENDING]: 'bg-amber-100 text-amber-700',
  [FISCAL_STATUS.SUMMARY_PENDING]: 'bg-blue-100 text-blue-700',
  [FISCAL_STATUS.FAILED]: 'bg-red-100 text-red-700',
  [FISCAL_STATUS.NOT_REQUIRED]: 'bg-gray-100 text-gray-700',
};

/** Drill-in view: one attendant's own unsettled transactions. */
const AttendantTransactionList = ({
  attendant,
  onBack,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelected,
  onClearAll,
  canSettle,
}) => {
  const transactions = attendant.transactions;
  const selectedCount = selectedIds.size;
  const selectedTotal = transactions
    .filter((t) => selectedIds.has(t.id))
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const allSelected = transactions.length > 0 && selectedIds.size === transactions.length;

  return (
    <div>
      <button onClick={onBack} className="text-sm text-indigo-600 hover:text-indigo-800 mb-2">
        ← Back to attendants
      </button>
      <h3 className="text-lg font-medium text-gray-900 mb-4">
        {attendant.name} <span className="text-gray-400 font-normal text-base">{attendant.attendantCode}</span>
      </h3>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {canSettle && (
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => onSelectAll(!allSelected)}
                    className="h-4 w-4 rounded border-gray-300"
                    aria-label="Select all transactions"
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pump</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Litres</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fiscal</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {transactions.map((t) => (
              <tr key={t.id}>
                {canSettle && (
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(t.id)}
                      onChange={() => onToggleSelect(t.id)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </td>
                )}
                <td className="px-4 py-3 text-sm text-gray-700">{t.pump?.code || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-700">{t.product?.name || '—'}</td>
                <td className="px-4 py-3 text-sm text-right text-gray-700">{Number(t.volume).toFixed(2)} L</td>
                <td className="px-4 py-3 text-sm text-right text-gray-900 font-medium">{money(t.amount)}</td>
                <td className="px-4 py-3 text-sm">
                  <span className={`px-2 py-0.5 rounded text-xs ${FISCAL_BADGE[t.fiscalStatus] || 'bg-gray-100 text-gray-700'}`}>
                    {t.fiscalStatus}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">{new Date(t.transactionTime).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canSettle && (
        <div className="mt-4 flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-700">
            Selected: <span className="font-medium">{selectedCount}</span> · Total:{' '}
            <span className="font-medium">{money(selectedTotal)}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClearSelected}
              disabled={selectedCount === 0}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Clear Selected
            </button>
            <button
              onClick={onClearAll}
              disabled={transactions.length === 0}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              Clear All
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendantTransactionList;
