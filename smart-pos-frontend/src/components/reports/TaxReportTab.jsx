import React from 'react';
import { fetchTaxReport, downloadTaxReportCsv } from '../../api/reportsApi';
import { money, StatTiles, ReportFilterBar, ReportTable, ReportStates, useReportTab } from './ReportShared';

const TaxReportTab = () => {
  const tab = useReportTab(fetchTaxReport);
  const { range, setRange, data, loading, error, exporting, setExporting, reload } = tab;

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadTaxReportCsv(range);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const summary = data?.summary || {};

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
            { label: 'Taxable Sales', value: money(summary.taxableSales) },
            { label: 'VAT Collected', value: money(summary.totalTax) },
            { label: 'Total Sales (incl. VAT)', value: money(summary.totalSales) },
            { label: 'Transactions', value: summary.transactionCount ?? 0 },
          ]}
        />

        <ReportTable
          title="By VAT Category"
          rows={data?.byCategory || []}
          rowKey={(r) => r.category}
          columns={[
            { key: 'category', label: 'Category' },
            { key: 'taxableAmount', label: 'Taxable', align: 'right', render: (r) => money(r.taxableAmount) },
            { key: 'taxAmount', label: 'VAT', align: 'right', render: (r) => money(r.taxAmount) },
            { key: 'totalAmount', label: 'Total', align: 'right', render: (r) => money(r.totalAmount) },
          ]}
        />

        <p className="text-xs text-gray-500">
          Figures use the per-line tax amounts recorded at the time of each sale, so a later change
          to a product&apos;s VAT rate never restates a period you have already filed.
        </p>
      </ReportStates>
    </div>
  );
};

export default TaxReportTab;
