import React from 'react';
import { exportShiftReportPdf } from '../../lib/shiftPdf';

const money = (n) => `K${Number(n || 0).toFixed(2)}`;

const formatDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const duration = (minutes) => {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const MOVEMENT_LABELS = { CASH_IN: 'Cash In', CASH_OUT: 'Cash Out', PAID_OUT: 'Paid Out' };

const Row = ({ label, value, strong, tone, indent }) => (
  <div className={`flex justify-between px-4 py-1.5 text-sm ${strong ? 'font-semibold' : ''}`}>
    <span className={`${strong ? '' : 'text-gray-600'} ${indent ? 'pl-4' : ''}`}>{label}</span>
    <span className={tone || ''}>{value}</span>
  </div>
);

const Block = ({ title, children }) => (
  <div className="divide-y divide-gray-100">
    <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
      {title}
    </div>
    <div className="divide-y divide-gray-50">{children}</div>
  </div>
);

/**
 * X-report on an OPEN shift (live snapshot — viewing it never closes or
 * changes anything), Z-report on a CLOSED one (the permanent reconciliation).
 *
 * A financial summary only: per-transaction detail lives in the Shift
 * Transaction Journal, reachable via "View Transactions", so this stays one
 * printable page no matter how busy the till was.
 */
const ShiftReportPanel = ({ report, onViewTransactions }) => {
  const [exportError, setExportError] = React.useState(null);

  if (!report) return null;

  // exportShiftReportPdf is async because jsPDF is fetched on demand; without
  // a catch a failed chunk load (offline, or stale after a redeploy) would
  // reject unhandled and the button would just look dead.
  const handleExportPdf = async () => {
    setExportError(null);
    try {
      await exportShiftReportPdf(report);
    } catch (err) {
      setExportError(`PDF export failed: ${err.message}`);
    }
  };

  const {
    shift = {},
    sales = {},
    cash = {},
    salesByMethod = [],
    refundsByMethod = [],
    cashMovements = [],
  } = report;

  const isClosed = shift.status === 'CLOSED';
  const variance = cash.variance;
  const varianceTone =
    variance == null || variance === 0
      ? 'text-gray-900'
      : variance > 0
        ? 'text-blue-700'
        : 'text-red-700';

  const refundByMethod = new Map(refundsByMethod.map((r) => [r.paymentMethod, r]));

  return (
    <div className="bg-white rounded-lg shadow print:shadow-none">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">
              {isClosed ? 'Z-Report' : 'X-Report'}
            </h3>
            <span
              className={`px-2 py-0.5 rounded text-xs ${
                isClosed ? 'bg-gray-100 text-gray-700' : 'bg-green-100 text-green-700'
              }`}
            >
              {isClosed ? 'FINAL RECONCILIATION' : 'LIVE SNAPSHOT'}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {shift.companyName && <span className="font-medium">{shift.companyName} · </span>}
            {shift.shiftNumber || shift.id} · {shift.branchName || shift.branchId} ·{' '}
            {shift.cashier?.name}
          </p>
          <p className="text-xs text-gray-500">
            Opened {formatDateTime(shift.openedAt)} ·{' '}
            {isClosed
              ? `Closed ${formatDateTime(shift.closedAt)}`
              : `As of ${formatDateTime(shift.generatedAt)}`}{' '}
            · {duration(shift.durationMinutes)}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          {onViewTransactions && (
            <button
              onClick={() => onViewTransactions(shift)}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              View Transactions
            </button>
          )}
          <button
            onClick={handleExportPdf}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Export PDF
          </button>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Print
          </button>
        </div>
      </div>

      {exportError && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700 print:hidden">
          {exportError}
        </div>
      )}

      {/* Expected cash — the number the whole report exists to produce */}
      <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between">
        <span className="text-sm font-medium text-indigo-900">Expected Cash in Drawer</span>
        <span className="text-2xl font-bold text-indigo-900">{money(cash.expectedCash)}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200">
        <div className="divide-y divide-gray-200">
          <Block title="Sales Summary">
            <Row label="Gross Sales" value={money(sales.grossSales)} />
            <Row label="Discounts" value={`-${money(sales.discounts)}`} />
            <Row label="Net Sales" value={money(sales.netSales)} strong />
            <Row label="Tax (VAT)" value={money(sales.tax)} />
            <Row label="Refunds" value={`-${money(sales.refunds)}`} />
            <Row label="Transactions" value={sales.transactionCount ?? 0} />
            <Row label="Refunds Issued" value={sales.refundCount ?? 0} indent />
            <Row label="Cancelled" value={sales.cancelledCount ?? 0} indent />
          </Block>

          <Block title="Payment Summary">
            {salesByMethod.length === 0 ? (
              <Row label="No sales recorded" value={money(0)} />
            ) : (
              salesByMethod.map((m) => {
                const refund = refundByMethod.get(m.paymentMethod);
                return (
                  <React.Fragment key={m.paymentMethod}>
                    <Row
                      label={m.paymentMethod}
                      value={`${money(m._sum?.total)} (${m._count})`}
                    />
                    {refund && (
                      <Row
                        label={`${m.paymentMethod} refunds`}
                        value={`-${money(refund._sum?.total)} (${refund._count})`}
                        indent
                      />
                    )}
                  </React.Fragment>
                );
              })
            )}
          </Block>
        </div>

        <div className="divide-y divide-gray-200">
          <Block title="Cash Movements">
            <Row label="Opening Float" value={money(cash.openingFloat)} />
            <Row label="Cash Sales" value={money(cash.cashSales)} />
            <Row label="Cash In" value={money(cash.cashIn)} />
            <Row label="Cash Out" value={`-${money(cash.cashOut)}`} />
            <Row label="Paid Out" value={`-${money(cash.paidOut)}`} />
            <Row label="Cash Refunds" value={`-${money(cash.cashRefunds)}`} />
          </Block>

          <Block title="Cash Position">
            <Row label="Expected Cash" value={money(cash.expectedCash)} strong />
            {isClosed ? (
              <>
                <Row label="Counted Cash" value={money(cash.countedCash)} />
                <Row
                  label={`Variance${variance ? (variance > 0 ? ' (over)' : ' (short)') : ''}`}
                  value={money(variance)}
                  strong
                  tone={varianceTone}
                />
                {cash.variancePct != null && (
                  <Row label="Variance %" value={`${cash.variancePct}%`} tone={varianceTone} indent />
                )}
                {shift.closedBy?.name && <Row label="Closed By" value={shift.closedBy.name} />}
              </>
            ) : (
              <Row
                label="Counted Cash"
                value="Pending — recorded at close"
                tone="text-gray-400"
              />
            )}
          </Block>
        </div>
      </div>

      {cashMovements.length > 0 && (
        <div className="border-t border-gray-200">
          <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
            Cash Movement Detail
          </div>
          <div className="overflow-x-auto">
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
        </div>
      )}

      {isClosed && shift.closingNotes && (
        <div className="px-4 py-3 border-t border-gray-200 text-sm">
          <span className="text-gray-500">Closing notes: </span>
          <span className="text-gray-800">{shift.closingNotes}</span>
        </div>
      )}
    </div>
  );
};

export default ShiftReportPanel;
