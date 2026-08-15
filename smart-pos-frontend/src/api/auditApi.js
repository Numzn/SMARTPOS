import { apiFetch } from '../lib/apiClient';

function auditQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  return search;
}

export function fetchAuditTrail(params = {}) {
  const qs = auditQuery(params).toString();
  return apiFetch(`/audit${qs ? `?${qs}` : ''}`);
}
