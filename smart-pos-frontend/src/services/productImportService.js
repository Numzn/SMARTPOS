import { apiFetch, API_BASE, getAuthHeaders } from '../lib/apiClient';

/**
 * Catalogue import/export.
 *
 * preview() and commit() hit the same endpoint; the only difference is the
 * commit flag. Keeping them as two named calls makes the call sites read
 * honestly — nothing is written unless something literally calls commit.
 */
export const productImportApi = {
  preview: (csv, createMissingCategories = false) =>
    apiFetch('/products/import', {
      method: 'POST',
      body: JSON.stringify({ csv, commit: false, createMissingCategories }),
    }),

  commit: (csv, createMissingCategories = false) =>
    apiFetch('/products/import', {
      method: 'POST',
      body: JSON.stringify({ csv, commit: true, createMissingCategories }),
    }),

  /** Downloads the catalogue as CSV — the same shape import accepts. */
  exportCsv: async () => {
    const res = await fetch(`${API_BASE}/products/export`, { headers: getAuthHeaders() });
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
    link.download = match ? match[1] : 'products.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
