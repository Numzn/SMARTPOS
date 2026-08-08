import { apiFetch, API_BASE, getAuthHeaders } from '../lib/apiClient';

/**
 * Stock-take import/export.
 *
 * The shape mirrors productImportApi, but this drives a different backend
 * path: each differing row becomes a RECOUNT stock adjustment, so the change
 * lands in the stock ledger and the ZRA audit trail rather than overwriting a
 * number.
 */
export const inventoryImportApi = {
  preview: (csv, branchId) =>
    apiFetch('/inventory/import', {
      method: 'POST',
      body: JSON.stringify({ csv, commit: false, branchId }),
    }),

  commit: (csv, branchId, reason) =>
    apiFetch('/inventory/import', {
      method: 'POST',
      body: JSON.stringify({ csv, commit: true, branchId, reason }),
    }),

  /**
   * Downloads current stock. Doubles as the stock-take sheet — `counted` comes
   * back blank, ready to be filled in and re-imported.
   */
  exportCsv: async (branchId) => {
    const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
    const res = await fetch(`${API_BASE}/inventory/export${qs}`, { headers: getAuthHeaders() });
    if (!res.ok) {
      let message = 'Export failed';
      try {
        message = (await res.json())?.error || message;
      } catch {
        /* non-JSON error body */
      }
      throw new Error(message);
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = match ? match[1] : 'stock_take.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
