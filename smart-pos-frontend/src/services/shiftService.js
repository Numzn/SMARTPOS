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

  /** Shift Transaction Journal — the drill-down behind the X/Z summary. */
  fetchShiftTransactions: (id, params = {}) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') search.set(k, v);
    }
    const qs = search.toString();
    return apiFetch(`/shifts/${id}/transactions${qs ? `?${qs}` : ''}`);
  },

  closeShift: (id, { countedCash, notes }) =>
    apiFetch(`/shifts/${id}/close`, {
      method: 'POST',
      body: JSON.stringify({ countedCash, notes }),
    }),

  /**
   * Cashier's "I'm done" action — locks the drawer, hands it off for
   * reconciliation, exposes no financial figures. Segregation of duties:
   * this is the only self-service end-of-shift action a Cashier has.
   */
  endShift: (id) => apiFetch(`/shifts/${id}/end`, { method: 'POST' }),

  /** Shifts awaiting a Supervisor+ to count and close them. */
  fetchPendingReconciliation: async () => {
    const data = await apiFetch('/shifts?status=PENDING_RECONCILIATION');
    return data.shifts || [];
  },

  /** Manager+ override for a shift reconciled in error. */
  reopenShift: (id, { notes } = {}) =>
    apiFetch(`/shifts/${id}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),
};
