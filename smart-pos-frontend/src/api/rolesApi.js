import { apiFetch } from '../lib/apiClient';

/**
 * Configurable RBAC admin surface — GET/PUT /api/settings/roles(/:role),
 * ADMIN-only on the backend (requireRole('ADMIN'), not just settings:write —
 * see routes/settings.js). Edits only ever write RolePermission rows; there
 * is no route here to ROLE_RANK or the approval-eligibility system, which
 * stay separate and unmodified.
 */

export async function fetchRoleMatrix() {
  return apiFetch('/settings/roles');
}

export async function setRolePermission(role, permission, granted) {
  return apiFetch(`/settings/roles/${role}`, {
    method: 'PUT',
    body: JSON.stringify({ permission, granted }),
  });
}
