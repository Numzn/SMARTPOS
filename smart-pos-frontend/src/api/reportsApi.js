import { apiFetch, API_BASE, getAuthHeaders } from '../lib/apiClient';

export function fetchReportSummary() {
  return apiFetch('/reports/summary');
}

export function fetchWeeklyReport(days) {
  return apiFetch(`/reports/weekly${days ? `?days=${days}` : ''}`);
}

export function fetchTransactions({ startDate, endDate, status } = {}) {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  if (status) params.set('status', status);
  const qs = params.toString();
  return apiFetch(`/reports/transactions${qs ? `?${qs}` : ''}`);
}

function reportQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  return search;
}

/**
 * Download a report CSV. Uses a raw fetch (not apiFetch) because the
 * response is a file blob, not JSON, then triggers a browser download.
 */
export async function downloadReportCsv(path, params = {}, fallbackFilename = 'report.csv') {
  const search = reportQuery(params);
  search.set('format', 'csv');

  const res = await fetch(`${API_BASE}${path}?${search.toString()}`, {
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    let message = 'Export failed';
    try {
      const data = await res.json();
      message = data?.error || message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match ? match[1] : fallbackFilename;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const downloadTransactionsCsv = (params) =>
  downloadReportCsv('/reports/transactions', params, 'transactions.csv');

/* ---------------- Phase 4 reports ---------------- */

const getReport = (path) => (params = {}) => {
  const qs = reportQuery(params).toString();
  return apiFetch(`${path}${qs ? `?${qs}` : ''}`);
};

export const fetchTaxReport = getReport('/reports/tax');
export const fetchProfitReport = getReport('/reports/profit');
export const fetchShiftHistoryReport = getReport('/reports/shifts');
export const fetchPurchaseReport = getReport('/reports/purchases');
export const fetchUserActivityReport = getReport('/reports/user-activity');

export const downloadTaxReportCsv = (p) => downloadReportCsv('/reports/tax', p, 'tax_report.csv');
export const downloadProfitReportCsv = (p) => downloadReportCsv('/reports/profit', p, 'profit_report.csv');
export const downloadShiftHistoryCsv = (p) => downloadReportCsv('/reports/shifts', p, 'shift_report.csv');
export const downloadPurchaseReportCsv = (p) => downloadReportCsv('/reports/purchases', p, 'purchase_report.csv');
export const downloadUserActivityCsv = (p) => downloadReportCsv('/reports/user-activity', p, 'user_activity.csv');

/* Inventory reports live under /inventory but are report data from this page's
   point of view, so they are surfaced here rather than in a separate module. */
export const fetchInventoryStockReport = getReport('/inventory/stock-report');
export const fetchInventoryMovementReport = getReport('/inventory/movement-report');
export const fetchInventoryValueReport = getReport('/inventory/value-report');
