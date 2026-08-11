import { apiFetch } from '../lib/apiClient';

/**
 * Server-side search over the ZRA-synced classification codes
 * (backend: services/zraCodesService.js searchItemClassifications, reading
 * the ZraClassificationCode table populated by /itemClass/selectItemsClass).
 * Never returns a deprecated (useYn='N') code and never the whole dataset —
 * bounded by `limit`. Backs the ClassificationPicker type-ahead.
 */
export async function searchClassificationCodes(query, { limit = 20, signal } = {}) {
  const params = new URLSearchParams();
  const term = (query || '').trim();
  if (term) params.set('q', term);
  params.set('limit', String(limit));
  return apiFetch(`/items/classification-codes?${params.toString()}`, { signal });
}
