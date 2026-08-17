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

  /**
   * Get-or-create the caller's active shift — what the till screen calls on
   * load instead of a manual "Open Shift" button. Returns an INITIALIZING
   * shift (opening cash not yet confirmed, see confirmOpeningCash below) or
   * an existing OPEN/INITIALIZING one, resumed rather than duplicated.
   */
  ensureShift: () => apiFetch('/shifts/ensure', { method: 'POST' }),

  /** Completes INITIALIZING -> OPEN with the cashier's counted opening cash. */
  confirmOpeningCash: (id, { openingFloat, notes }) =>
    apiFetch(`/shifts/${id}/confirm-opening`, {
      method: 'POST',
      body: JSON.stringify({ openingFloat, notes }),
    }),

  /** Back-office escape hatch for a shift stuck awaiting opening-cash confirmation. */
  cancelInitialization: (id) => apiFetch(`/shifts/${id}/cancel-initialization`, { method: 'POST' }),

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

  /**
   * Reconcile: reads the counted total from the shift's own
   * CashierDeclaration (submitDeclaration below) rather than accepting one
   * here — the backend computes variance from ZReport.expectedClosingCash
   * (frozen at end-time) vs the declaration, never a number passed in this
   * call.
   */
  closeShift: (id, { notes } = {}) =>
    apiFetch(`/shifts/${id}/close`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),

  /**
   * Cashier's "I'm done" action — locks the drawer, hands it off for
   * reconciliation, exposes no financial figures. Segregation of duties:
   * this is the only self-service end-of-shift action a Cashier has.
   * Requires a Supervisor+ approvalId (see SupervisorApprovalModal,
   * actionType="SHIFT_END") — the backend rejects the call without one.
   */
  endShift: (id, { approvalId }) =>
    apiFetch(`/shifts/${id}/end`, {
      method: 'POST',
      body: JSON.stringify({ approvalId }),
    }),

  /**
   * The frozen Z-report artifact for an ended shift — never recomputed.
   * Carries the declaration nested (`.declaration`) once the cashier has
   * submitted one; there's no separate GET for the declaration alone.
   */
  fetchZReport: (id) => apiFetch(`/shifts/${id}/z-report`),

  /**
   * The cashier's own physical cash count for their own ended shift.
   * Immutable once submitted — a correction is a ShiftAdjustment
   * (createAdjustment below), never a re-submission.
   */
  submitDeclaration: (id, { declaredTotal, denominations }) =>
    apiFetch(`/shifts/${id}/declaration`, {
      method: 'POST',
      body: JSON.stringify({ declaredTotal, denominations }),
    }),

  /** Back-office: every currently OPEN shift, store-wide. */
  fetchActiveTills: async () => {
    const data = await apiFetch('/shifts/active-tills');
    return data.shifts || [];
  },

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

  /**
   * The only way a variance's story changes after the fact — never touches
   * the original ZReport/CashierDeclaration rows.
   */
  createAdjustment: (id, { reason, resolutionNote }) =>
    apiFetch(`/shifts/${id}/adjustments`, {
      method: 'POST',
      body: JSON.stringify({ reason, resolutionNote }),
    }),

  fetchAdjustments: async (id) => {
    const data = await apiFetch(`/shifts/${id}/adjustments`);
    return data.adjustments || [];
  },

  /** Cash removed to the safe — its own reporting line, not a plain payout. */
  recordSafeDrop: (id, { amount, safeId, witnessUserId, reason }) =>
    apiFetch(`/shifts/${id}/safe-drop`, {
      method: 'POST',
      body: JSON.stringify({ amount, safeId, witnessUserId, reason }),
    }),
};
