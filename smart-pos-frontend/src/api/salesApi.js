import { apiFetch } from '../lib/apiClient';

export async function fetchSales() {
  return apiFetch('/sales');
}

export async function fetchSale(saleId) {
  return apiFetch(`/sales/${saleId}`);
}

export async function fetchSaleRefunds(saleId) {
  return apiFetch(`/sales/${saleId}/refunds`);
}

/**
 * @param {string} saleId
 * @param {{ userId: string, reasonCode?: string, reason?: string, items?: { saleItemId: string, quantity: number }[] }} payload
 */
export async function refundSale(saleId, payload) {
  return apiFetch(`/sales/${saleId}/refund`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export const REFUND_REASON_CODES = [
  { code: '01', label: 'Customer return' },
  { code: '02', label: 'Damaged goods' },
  { code: '03', label: 'Wrong item sold' },
  { code: '04', label: 'Other' },
];

export function getSaleStatusBadge(status) {
  const map = {
    COMPLETED: { label: 'Completed', className: 'bg-green-100 text-green-800' },
    REFUNDED: { label: 'Refunded', className: 'bg-gray-200 text-gray-800' },
    PENDING: { label: 'Pending', className: 'bg-yellow-100 text-yellow-800' },
    FISCAL_SUBMITTING: { label: 'Submitting', className: 'bg-blue-100 text-blue-800' },
    FISCAL_FAILED: { label: 'Fiscal failed', className: 'bg-red-100 text-red-800' },
    CANCELLED: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600' },
  };
  return map[status] || { label: status, className: 'bg-gray-100 text-gray-700' };
}
