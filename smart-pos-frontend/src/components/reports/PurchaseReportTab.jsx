import React from 'react';
import { fetchPurchaseReport, downloadPurchaseReportCsv } from '../../api/reportsApi';
import {
  money, formatDate, StatTiles, ReportFilterBar, ReportTable, ReportStates, useReportTab,
} from './ReportShared';

const statusColors = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SENT: 'bg-blue-100 text-blue-700',
  PARTIALLY_RECEIVED: 'bg-yellow-100 text-yellow-700',
  RECEIVED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

/**
 * Spend analysis only — raising, editing, and receiving orders all live on the
 * Purchasing page. This tab deliberately has no actions.
 */
const PurchaseReportTab = () => {
  const { range, setRange, data, loading, error, exporting, setExporting, reload } =
    useReportTab(fetchPurchaseReport);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadPurchaseReportCsv(range);
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
            { label: 'Orders Raised', value: summary.orderCount ?? 0 },
            { label: 'Ordered Value', value: money(summary.totalOrderValue) },
            {
              label: 'Received Value',
              value: money(summary.totalReceivedValue),
              hint: 'Stock actually delivered',
            },
            {
              label: 'Open Orders',
              value: summary.openOrders ?? 0,
              hint: `${summary.receivedOrders ?? 0} received, ${summary.cancelledOrders ?? 0} cancelled`,
            },
          ]}
        />

        <ReportTable
          title="By Supplier"
          rows={data?.bySupplier || []}
          rowKey={(r) => r.supplierId}
          columns={[
            { key: 'supplierName', label: 'Supplier' },
            { key: 'orderCount', label: 'Orders', align: 'right' },
            { key: 'orderValue', label: 'Ordered', align: 'right', render: (r) => money(r.orderValue) },
            { key: 'receivedValue', label: 'Received', align: 'right', render: (r) => money(r.receivedValue) },
          ]}
        />

        <ReportTable
          title="Orders"
          rows={data?.orders || []}
          rowKey={(r) => r.id}
          columns={[
            { key: 'poNumber', label: 'PO Number' },
            { key: 'supplierName', label: 'Supplier' },
            {
              key: 'status',
              label: 'Status',
              render: (r) => (
                <span className={`px-2 py-0.5 rounded text-xs ${statusColors[r.status] || ''}`}>
                  {r.status}
                </span>
              ),
            },
            { key: 'orderDate', label: 'Ordered', render: (r) => formatDate(r.orderDate) },
            { key: 'total', label: 'Total', align: 'right', render: (r) => money(r.total) },
          ]}
        />

        <p className="text-xs text-gray-500">
          Ordered and received values differ legitimately: an order may be partly delivered, and a
          delivery in this period may settle an order raised in an earlier one.
        </p>
      </ReportStates>
    </div>
  );
};

export default PurchaseReportTab;
