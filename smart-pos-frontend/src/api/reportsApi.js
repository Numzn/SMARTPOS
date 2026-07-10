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

/**
 * Download a transactions CSV. Uses a raw fetch (not apiFetch) because the
 * response is a file blob, not JSON, then triggers a browser download.
 */
export async function downloadTransactionsCsv({ startDate, endDate, status } = {}) {
  const params = new URLSearchParams({ format: 'csv' });
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  if (status) params.set('status', status);

  const res = await fetch(`${API_BASE}/reports/transactions?${params.toString()}`, {
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
  const filename = match ? match[1] : 'transactions.csv';

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
