import React from 'react';
import { fetchProfitReport, downloadProfitReportCsv } from '../../api/reportsApi';
import { money, pct, StatTiles, ReportFilterBar, ReportTable, ReportStates, useReportTab } from './ReportShared';

const ProfitReportTab = () => {
  const { range, setRange, data, loading, error, exporting, setExporting, reload } =
    useReportTab(fetchProfitReport);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadProfitReportCsv(range);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const summary = data?.summary || {};
  const missing = summary.salesMissingCostBasis || 0;

  return (
    <div className="space-y-4">
      <ReportFilterBar
        range={range}
        setRange={setRange}
        onApply={reload}
        onExport={handleExport}
        exporting={exporting}
      />

      <ReportStates loading={loading} error={error} onRetry={reload}>
        <StatTiles
          tiles={[
            { label: 'Revenue', value: money(summary.revenue) },
            { label: 'Cost of Goods Sold', value: money(summary.cogs) },
            {
              label: 'Gross Profit',
              value: money(summary.grossProfit),
              tone: (summary.grossProfit || 0) >= 0 ? 'text-green-700' : 'text-red-700',
            },
            { label: 'Margin', value: pct(summary.marginPct) },
          ]}
        />

        {missing > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
            <strong>{missing}</strong> sale{missing === 1 ? '' : 's'} in this period ha
            {missing === 1 ? 's' : 've'} no recorded cost basis, so they contribute revenue but no
            cost — margin above is overstated by that amount. This happens for sales created outside
            the normal checkout flow (imported or backfilled data).
          </div>
        )}

        <ReportTable
          title="Top Products by Gross Profit"
          rows={data?.byProduct || []}
          rowKey={(r) => r.productId}
          columns={[
            { key: 'productName', label: 'Product' },
            { key: 'sku', label: 'SKU', render: (r) => r.sku || '—' },
            { key: 'unitsSold', label: 'Units', align: 'right' },
            { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => money(r.revenue) },
            { key: 'cogs', label: 'COGS', align: 'right', render: (r) => money(r.cogs) },
            {
              key: 'grossProfit',
              label: 'Gross Profit',
              align: 'right',
              render: (r) => money(r.grossProfit),
              tone: (r) => (r.grossProfit >= 0 ? 'text-green-700' : 'text-red-700'),
            },
            { key: 'marginPct', label: 'Margin', align: 'right', render: (r) => pct(r.marginPct) },
          ]}
        />

        <p className="text-xs text-gray-500">
          Cost of goods sold uses the weighted-average cost at the moment each sale was completed,
          not today&apos;s cost — so restocking at a new price never rewrites past margins.
        </p>
      </ReportStates>
    </div>
  );
};

export default ProfitReportTab;
