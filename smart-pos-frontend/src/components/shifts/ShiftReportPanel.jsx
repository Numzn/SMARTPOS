import React from 'react';

const money = (n) => `K${Number(n || 0).toFixed(2)}`;

const formatDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const MOVEMENT_LABELS = { CASH_IN: 'Cash In', CASH_OUT: 'Cash Out', PAID_OUT: 'Paid Out' };

/**
 * X-report for an OPEN shift (a mid-shift snapshot), Z-report for a CLOSED one
 * (final reconciled figures). Same panel either way — the backend decides which
 * numbers it returns; the only visual difference is the counted/variance rows,
 * which exist only once a shift has actually been closed.
 */
const ShiftReportPanel = ({ report, onPrint }) => {
  if (!report) return null;

  const { shift, cash, salesByMethod = [], refundsByMethod = [], saleCount, refundCount, cashMovements = [] } = report;
  const isClosed = shift?.status === 'CLOSED';
  const variance = cash?.variance;

  const varianceTone =
    variance == null || variance === 0
      ? 'text-gray-900'
      : variance > 0
        ? 'text-blue-700'
        : 'text-red-700';

  const row = (label, value, opts = {}) => (
    <div className={`flex justify-between px-4 py-2 text-sm ${opts.strong ? 'font-semibold' : ''}`}>
      <span className={opts.strong ? '' : 'text-gray-600'}>{label}</span>
      <span className={opts.tone || ''}>{value}</span>
    </div>
  );

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div>
          <h3 className="font-semibold text-gray-900">
            {isClosed ? 'Z-Report (final)' : 'X-Report (live snapshot)'}
          </h3>
          <p className="text-xs text-gray-500">
            {shift?.cashier?.name} · opened {formatDateTime(shift?.openedAt)}
            {isClosed && ` · closed ${formatDateTime(shift?.closedAt)}`}
          </p>
        </div>
        {onPrint && (
          <button
            onClick={onPrint}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Print
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200">
        <div className="divide-y divide-gray-100">
          <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-500 uppercase">
            Cash Drawer
          </div>
          {row('Opening float', money(cash?.openingFloat))}
          {row('Cash sales', money(cash?.cashSales))}
          {row('Cash refunds', `-${money(cash?.cashRefunds)}`)}
          {row('Cash in', money(cash?.cashIn))}
          {row('Cash out', `-${money(cash?.cashOut)}`)}
          {row('Paid out', `-${money(cash?.paidOut)}`)}
          {row('Expected in drawer', money(cash?.expectedCash), { strong: true })}
          {isClosed && row('Counted', money(cash?.countedCash))}
          {isClosed &&
            row(
              `Variance${variance ? (variance > 0 ? ' (over)' : ' (short)') : ''}`,
              money(variance),
              { strong: true, tone: varianceTone }
            )}
        </div>

        <div className="divide-y divide-gray-100">
          <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-500 uppercase">
            Sales &amp; Refunds
          </div>
          {row('Completed sales', saleCount ?? 0)}
          {salesByMethod.map((s) => (
            <div key={`sale-${s.paymentMethod}`} className="flex justify-between px-4 py-2 text-sm">
              <span className="text-gray-600 pl-3">{s.paymentMethod}</span>
              <span>
                {money(s._sum?.total)}{' '}
                <span className="text-gray-400">({s._count})</span>
              </span>
            </div>
          ))}
          {row('Completed refunds', refundCount ?? 0)}
          {refundsByMethod.map((r) => (
            <div key={`refund-${r.paymentMethod}`} className="flex justify-between px-4 py-2 text-sm">
              <span className="text-gray-600 pl-3">{r.paymentMethod}</span>
              <span>
                -{money(r._sum?.total)}{' '}
                <span className="text-gray-400">({r._count})</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {cashMovements.length > 0 && (
        <div className="border-t border-gray-200">
          <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-500 uppercase">
            Cash Movements
          </div>
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {cashMovements.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2 text-gray-700">{MOVEMENT_LABELS[m.type] || m.type}</td>
                  <td className="px-4 py-2 text-gray-500">{m.reason || '—'}</td>
                  <td className="px-4 py-2 text-gray-500">{formatDateTime(m.createdAt)}</td>
                  <td className="px-4 py-2 text-right">{money(m.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ShiftReportPanel;
