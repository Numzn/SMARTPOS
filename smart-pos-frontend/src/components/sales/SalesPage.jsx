import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { RefreshCw, RotateCcw, Receipt, Search } from 'lucide-react';
import { fetchSales, getSaleStatusBadge } from '../../api/salesApi';
import { usePermissions } from '../../hooks/usePermissions';
import RefundModal from './RefundModal';

function saleMatchesSearch(sale, term) {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  if (sale.rcptNo?.toLowerCase().includes(q)) return true;
  if (sale.id?.toLowerCase().includes(q)) return true;
  if (sale.user?.name?.toLowerCase().includes(q)) return true;
  if (sale.user?.email?.toLowerCase().includes(q)) return true;
  if (String(sale.total).includes(q)) return true;
  if (sale.status?.toLowerCase().includes(q)) return true;
  for (const item of sale.saleItems || []) {
    if (item.product?.name?.toLowerCase().includes(q)) return true;
    if (item.product?.sku?.toLowerCase().includes(q)) return true;
  }
  return false;
}

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'REFUNDED', label: 'Refunded' },
  { id: 'FISCAL_FAILED', label: 'Fiscal failed' },
];

const SalesPage = () => {
  const { canAccess } = usePermissions();
  const outlet = useOutletContext() || {};
  const headerSearch = outlet.headerSearch ?? '';
  const setHeaderSearch = outlet.setHeaderSearch;
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [localSearch, setLocalSearch] = useState('');
  const [refundSale, setRefundSale] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const loadSales = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSales();
      setSales(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load sales');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  const searchTerm = localSearch || headerSearch;

  const filtered = useMemo(() => {
    let list = sales;
    if (statusFilter !== 'all') {
      list = list.filter((s) => s.status === statusFilter);
    }
    if (searchTerm.trim()) {
      list = list.filter((s) => saleMatchesSearch(s, searchTerm));
    }
    return list;
  }, [sales, statusFilter, searchTerm]);

  const canRefund = (sale) =>
    canAccess.refundSale &&
    sale.status === 'COMPLETED' &&
    sale.rcptNo;

  const formatMoney = (n) => `K${Number(n || 0).toFixed(2)}`;
  const formatDate = (d) =>
    new Date(d).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales & refunds</h1>
          <p className="text-sm text-gray-500">Completed fiscal sales and credit note refunds</p>
        </div>
        <button
          type="button"
          onClick={loadSales}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            placeholder="Search receipt, cashier, product, amount…"
            value={localSearch || headerSearch}
            onChange={(e) => {
              const v = e.target.value;
              setLocalSearch(v);
              setHeaderSearch?.(v);
            }}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-400"
            aria-label="Search sales"
          />
        </div>
        <p className="text-xs text-gray-500 sm:text-right">
          {filtered.length} of {sales.length} sale{sales.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatusFilter(f.id)}
            className={`px-3 py-1.5 text-sm rounded-full border ${
              statusFilter === f.id
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Receipt</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cashier</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                    Loading sales…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                    No sales match your search or filter.
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((sale) => {
                  const badge = getSaleStatusBadge(sale.status);
                  const expanded = expandedId === sale.id;
                  return (
                    <Fragment key={sale.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                          {formatDate(sale.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-gray-800">
                          {sale.rcptNo || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {sale.user?.name || sale.user?.email || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                          {formatMoney(sale.total)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${badge.className}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : sale.id)}
                            className="text-sm text-gray-600 hover:text-gray-900"
                          >
                            {expanded ? 'Hide' : 'Items'}
                          </button>
                          {canRefund(sale) && (
                            <button
                              type="button"
                              onClick={() => setRefundSale(sale)}
                              className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-800 font-medium"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Refund
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-gray-50">
                          <td colSpan={6} className="px-4 py-3">
                            <ul className="text-sm text-gray-700 space-y-1">
                              {(sale.saleItems || []).map((item) => (
                                <li key={item.id} className="flex justify-between gap-4">
                                  <span>
                                    {item.product?.name || item.productId} × {item.quantity}
                                  </span>
                                  <span className="font-mono text-gray-600">{formatMoney(item.total)}</span>
                                </li>
                              ))}
                            </ul>
                            {sale.qrCode && (
                              <p className="mt-2 text-xs text-gray-500 flex items-center gap-1">
                                <Receipt className="w-3.5 h-3.5" />
                                <span className="truncate">{sale.qrCode}</span>
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {refundSale && (
        <RefundModal
          sale={refundSale}
          onClose={() => setRefundSale(null)}
          onSuccess={() => {
            loadSales();
          }}
        />
      )}
    </div>
  );
};

export default SalesPage;
