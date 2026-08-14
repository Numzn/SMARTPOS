import { apiFetch } from '../lib/apiClient';

/**
 * User administration. Every endpoint here is ADMIN-only server-side
 * (requireRole('ADMIN')), so the UI gates on role as well to avoid offering
 * actions that would only come back as a 403.
 */
export const userApi = {
  fetchUsers: () => apiFetch('/users'),

  fetchUser: (id) => apiFetch(`/users/${id}`),

  createUser: ({ name, email, password, role }) =>
    apiFetch('/users/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, role }),
    }),

  /** Only role, isActive and name are updatable; anything else is ignored server-side. */
  updateUser: (id, { name, role, isActive }) =>
    apiFetch(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, role, isActive }),
    }),

  setActive: (id, isActive) =>
    apiFetch(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ isActive }) }),

  /**
   * Omit newPassword to have the server generate a temporary one, which it
   * returns so the admin can hand it over.
   */
  resetPassword: (id, newPassword) =>
    apiFetch(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify(newPassword ? { newPassword } : {}),
    }),

  /**
   * Sets/resets a supervisor step-up PIN — POS Control Phase 1. Omit `pin`
   * to have the server generate one, returned as `temporaryPin`. Meaningful
   * for SUPERVISOR/MANAGER/ADMIN accounts (the ones ROLE_RANK allows to
   * approve a till reversal or over-threshold discount); harmless but
   * unused if set on a CASHIER.
   */
  setPin: (id, pin) =>
    apiFetch(`/users/${id}/pin`, {
      method: 'POST',
      body: JSON.stringify(pin ? { pin } : {}),
    }),
};

export const ROLES = ['ADMIN', 'MANAGER', 'SUPERVISOR', 'CASHIER', 'VIEWER'];

export const ROLE_DESCRIPTIONS = {
  ADMIN: 'Full access, including user administration and settings',
  MANAGER: 'Back office — products, inventory, purchasing, reports, shifts',
  SUPERVISOR: 'Till-floor authority — approves cashier reversals and discounts via PIN, otherwise works a till like a cashier',
  CASHIER: 'Till only — sell, refund, manage their own shift and customers',
  VIEWER: 'Read-only access to products, inventory, sales and reports',
};

// Roles that can hold a supervisor step-up PIN (POS Control Phase 1) — kept
// as a plain array, not derived from ROLE_RANK, so the frontend doesn't need
// to import backend-only constants; must stay in sync with
// middleware/auth.js's ROLE_RANK.SUPERVISOR floor.
export const PIN_ELIGIBLE_ROLES = ['SUPERVISOR', 'MANAGER', 'ADMIN'];
