import { apiFetch } from '../lib/apiClient';

export async function fetchReceipt(sourceType, sourceId, { reprint = false } = {}) {
  const qs = reprint ? '?reprint=true' : '';
  return apiFetch(`/receipts/${sourceType}/${sourceId}${qs}`);
}

export async function fetchBusinessSettings() {
  return apiFetch('/settings/business');
}

export async function updateBusinessSettings(payload) {
  return apiFetch('/settings/business', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
