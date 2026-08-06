import React from 'react';
import { fetchShiftHistoryReport, downloadShiftHistoryCsv } from '../../api/reportsApi';
import {
  money, formatDateTime, StatTiles, ReportFilterBar, ReportTable, ReportStates, useReportTab,
} from './ReportShared';

const statusColors = {
  OPEN: 'bg-green-100 text-green-700',
  CLOSED: 'bg-gray-100 text-gray-700',
};

/**
 * Cash reconciliation and shift history in one view — a shift row *is* the
 * cash-drawer session, so splitting them would mean two tables over the same
 * data.
 */
const CashShiftReportTab = () => {
  const { range, setRange, data, loading, error, exporting, setExporting, reload } =
    useReportTab(fetchShiftHistoryReport);
  const [status, setStatus] = React.useState('');

  const params = { ...range, ...(status ? { status } : {}) };

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadShiftHistoryCsv(params);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const summary = data?.summary || {};
  const varianceTone = (v) =>
    v == null ? 'text-gray-400' : v === 0 ? 'text-gray-700' : v > 0 ? 'text-blue-700' : 'text-red-700';

  return (
    <div className="space-y-4">
      <ReportFilterBar
        range={range}
        setRange={setRange}
        onApply={reload}
        onExport={handleExport}
        exporting={exporting}
      >
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
      </ReportFilterBar>

      <ReportStates loading={loading} error={error} onRetry={reload}>
        <StatTiles
          tiles={[
            { label: 'Shifts', value: summary.shiftCount ?? 0, hint: `${summary.openCount ?? 0} open` },
            { label: 'Sales Through Till', value: money(summary.totalSales) },
            {
              label: 'Total Variance',
              value: money(summary.totalVariance),
              tone: (summary.totalVariance || 0) === 0 ? 'text-gray-900' : 'text-red-700',
            },
            {
              label: 'Shifts With Variance',
              value: summary.shiftsWithVariance ?? 0,
              tone: (summary.shiftsWithVariance || 0) > 0 ? 'text-red-700' : 'text-gray-900',
              hint: `of ${summary.closedCount ?? 0} closed`,
            },
          ]}
        />

        <ReportTable
          title="Shift History"
          rows={data?.shifts || []}
          rowKey={(r) => r.id}
          empty="No shifts opened in this period."
          columns={[
            { key: 'cashier', label: 'Cashier', render: (r) => r.cashier?.name || '—' },
            {
              key: 'status',
              label: 'Status',
              render: (r) => (
                <span className={`px-2 py-0.5 rounded text-xs ${statusColors[r.status] || ''}`}>
                  {r.status}
                </span>
              ),
            },
            { key: 'openedAt', label: 'Opened', render: (r) => formatDateTime(r.openedAt) },
            {
              key: 'durationMinutes',
              label: 'Duration',
              align: 'right',
              render: (r) => (r.durationMinutes == null ? '—' : `${Math.floor(r.durationMinutes / 60)}h ${r.durationMinutes % 60}m`),
            },
            { key: 'salesCount', label: 'Sales', align: 'right' },
            { key: 'salesTotal', label: 'Sales Total', align: 'right', render: (r) => money(r.salesTotal) },
            {
              key: 'expectedCash',
              label: 'Expected',
              align: 'right',
              render: (r) => (r.expectedCash == null ? '—' : money(r.expectedCash)),
            },
            {
              key: 'countedCash',
              label: 'Counted',
              align: 'right',
              render: (r) => (r.countedCash == null ? '—' : money(r.countedCash)),
            },
            {
              key: 'variance',
              label: 'Variance',
              align: 'right',
              render: (r) => (r.variance == null ? '—' : money(r.variance)),
              tone: (r) => varianceTone(r.variance),
            },
          ]}
        />
      </ReportStates>
    </div>
  );
};

export default CashShiftReportTab;
