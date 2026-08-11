import { apiFetch } from '../lib/apiClient';

/**
 * Bounded, small enumerable ZRA code lists (tax type, package unit, quantity
 * unit) — unlike classification's thousands of rows, these don't need
 * search/pagination, just "the current usable set for this class," read
 * from the synced ZraCode table (services/zraCodesService.js).
 */
export async function fetchTaxTypes() {
  return apiFetch('/items/tax-types');
}

export async function fetchPackageUnits() {
  return apiFetch('/items/package-units');
}

export async function fetchQuantityUnits() {
  return apiFetch('/items/quantity-units');
}
