import { apiFetch } from '../lib/apiClient';

/**
 * Phase 1 only — attendant/pump roster and fuel-transaction seed/read
 * calls. No settlement/clearing calls yet; those land once the Attendant
 * Clearing UI (later phase) needs a real shape to call.
 */
export const forecourtApi = {
  fetchAttendants: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/forecourt/attendants${qs ? `?${qs}` : ''}`);
  },
  createAttendant: (data) => apiFetch('/forecourt/attendants', { method: 'POST', body: JSON.stringify(data) }),

  fetchPumps: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/forecourt/pumps${qs ? `?${qs}` : ''}`);
  },
  createPump: (data) => apiFetch('/forecourt/pumps', { method: 'POST', body: JSON.stringify(data) }),

  fetchTransactions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/forecourt/transactions${qs ? `?${qs}` : ''}`);
  },
  createTransaction: (data) => apiFetch('/forecourt/transactions', { method: 'POST', body: JSON.stringify(data) }),
};
