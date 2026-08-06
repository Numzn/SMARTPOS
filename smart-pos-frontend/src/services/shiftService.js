import { apiFetch } from '../lib/apiClient';

export const shiftApi = {
  /**
   * The requesting cashier's own open shift. The backend 404s when there is
   * no open shift, which is a normal state — surface it as null rather than
   * an error so callers can just check for absence.
   */
  fetchCurrentShift: async () => {
    try {
      return await apiFetch('/shifts/current');
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  },

  fetchShifts: async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const data = await apiFetch(`/shifts${qs ? `?${qs}` : ''}`);
    return data.shifts || [];
  },

  fetchShift: (id) => apiFetch(`/shifts/${id}`),

  /** X-report on an OPEN shift, Z-report on a CLOSED one. */
  fetchShiftReport: (id) => apiFetch(`/shifts/${id}/report`),

  openShift: ({ openingFloat, notes }) =>
    apiFetch('/shifts/open', {
      method: 'POST',
      body: JSON.stringify({ openingFloat, notes }),
    }),

  recordCashMovement: (id, type, { amount, reason }) => {
    const path = { CASH_IN: 'cash-in', CASH_OUT: 'cash-out', PAID_OUT: 'paid-out' }[type];
    if (!path) throw new Error(`Unknown cash movement type: ${type}`);
    return apiFetch(`/shifts/${id}/${path}`, {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
    });
  },

  closeShift: (id, { countedCash, notes }) =>
    apiFetch(`/shifts/${id}/close`, {
      method: 'POST',
      body: JSON.stringify({ countedCash, notes }),
    }),
};
