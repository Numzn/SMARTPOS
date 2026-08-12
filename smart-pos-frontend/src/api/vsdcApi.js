import { apiFetch } from '../lib/apiClient';

/**
 * Admin-scoped VSDC device/codes/branch sync actions — the ZRA Sync page.
 * cashierApi.js keeps its own fetchVsdcStatus() for the till's status pill;
 * that one stays untouched and separate from this admin-scoped module.
 */

export async function fetchDeviceStatus() {
  return apiFetch('/vsdc/status');
}

export async function initializeDevice() {
  return apiFetch('/vsdc/initialize', { method: 'POST' });
}

export async function fetchCodesStatus() {
  return apiFetch('/vsdc/codes/status');
}

export async function syncCodes() {
  return apiFetch('/vsdc/codes/sync', { method: 'POST' });
}

export async function syncBranches() {
  return apiFetch('/vsdc/branches/sync', { method: 'POST' });
}
