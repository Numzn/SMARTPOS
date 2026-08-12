import { apiFetch } from '../lib/apiClient';

export async function fetchBranches() {
  return apiFetch('/branches');
}
