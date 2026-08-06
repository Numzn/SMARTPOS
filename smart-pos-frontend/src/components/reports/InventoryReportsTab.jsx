import React, { useState, useEffect, useCallback } from 'react';
import { fetchInventoryStockReport, fetchInventoryValueReport } from '../../api/reportsApi';
import { money, StatTiles, ReportTable, ReportStates } from './ReportShared';

/**
 * Surfaces the stock and valuation endpoints that already existed under
 * /api/inventory but had no UI calling them.
 */
const InventoryReportsTab = () => {
  const [stock, setStock] = useState(null);
  const [value, setValue] = useState(null);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (lowStock) => {
    setLoading(true);
    setError(null);
    try {
      const [stockData, valueData] = await Promise.all([
        fetchInventoryStockReport(lowStock ? { lowStock: 'true' } : {}),
        fetchInventoryValueReport(),
      ]);
      setStock(stockData);
      setValue(valueData);
    } catch (err) {
      setError(err?.data?.error || err.message || 'Failed to load inventory reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(lowStockOnly);
  }, [load, lowStockOnly]);

  const valueSummary = value?.summary || {};
  const stockSummary = stock?.summary || {};

  return (
    <div className="space-y-4">
      <ReportStates loading={loading} error={error} onRetry={() => load(lowStockOnly)}>
        <StatTiles
          tiles={[
            { label: 'Stock Value', value: money(valueSummary.totalValue) },
            { label: 'Units in Stock', value: stockSummary.totalStock ?? 0 },
            { label: 'Products Tracked', value: stockSummary.totalProducts ?? 0 },
            {
              label: 'Low Stock Items',
              value: stockSummary.lowStockItems ?? 0,
              tone: (stockSummary.lowStockItems || 0) > 0 ? 'text-red-700' : 'text-gray-900',
            },
          ]}
        />

        <ReportTable
          title="Value by Category"
          rows={value?.categoryBreakdown || []}
          rowKey={(r) => r.category || r.name}
          columns={[
            { key: 'category', label: 'Category', render: (r) => r.category || r.name },
            { key: 'productCount', label: 'Products', align: 'right' },
            { key: 'totalStock', label: 'Units', align: 'right' },
            { key: 'totalValue', label: 'Value', align: 'right', render: (r) => money(r.totalValue) },
            { key: 'percentage', label: '% of Value', align: 'right', render: (r) => `${r.percentage}%` },
          ]}
        />

        <div className="flex items-center justify-between">
          <h3 className="font-medium text-gray-900">Stock on Hand</h3>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(e) => setLowStockOnly(e.target.checked)}
            />
            Low stock only
          </label>
        </div>

        <ReportTable
          rows={stock?.report || []}
          rowKey={(r) => r.productId}
          empty={lowStockOnly ? 'Nothing is below its reorder point.' : 'No inventory records.'}
          columns={[
            { key: 'productName', label: 'Product' },
            { key: 'sku', label: 'SKU' },
            { key: 'category', label: 'Category', render: (r) => r.category || '—' },
            {
              key: 'currentStock',
              label: 'On Hand',
              align: 'right',
              tone: (r) => (r.lowStockAlert ? 'text-red-700 font-medium' : 'text-gray-700'),
            },
            { key: 'reorderPoint', label: 'Reorder At', align: 'right' },
            { key: 'averageCost', label: 'Avg Cost', align: 'right', render: (r) => money(r.averageCost) },
            { key: 'totalValue', label: 'Value', align: 'right', render: (r) => money(r.totalValue) },
          ]}
        />
      </ReportStates>
    </div>
  );
};

export default InventoryReportsTab;
