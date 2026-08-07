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
};

export const ROLES = ['ADMIN', 'MANAGER', 'CASHIER', 'VIEWER'];

export const ROLE_DESCRIPTIONS = {
  ADMIN: 'Full access, including user administration and settings',
  MANAGER: 'Back office — products, inventory, purchasing, reports, shifts',
  CASHIER: 'Till only — sell, refund, manage their own shift and customers',
  VIEWER: 'Read-only access to products, inventory, sales and reports',
};
