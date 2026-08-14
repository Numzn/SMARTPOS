// Cashier API — uses shared apiFetch client
import { apiFetch } from '../lib/apiClient';

export async function fetchProducts() {
  return apiFetch('/products');
}

export async function fetchCategories() {
  return apiFetch('/categories');
}

/** Map UI payment ids to backend PaymentMethod enum */
export function mapPaymentMethod(method) {
  const map = {
    cash: 'CASH',
    card: 'CARD',
    mobile: 'DIGITAL_WALLET',
    bank: 'BANK_TRANSFER',
  };
  return map[method] || 'CASH';
}

export async function fetchVsdcStatus() {
  return apiFetch('/vsdc/status');
}

export async function checkoutSale(saleData) {
  return apiFetch('/sales/checkout', {
    method: 'POST',
    body: JSON.stringify(saleData),
  });
}

export async function createSale(saleData) {
  return apiFetch('/sales', {
    method: 'POST',
    body: JSON.stringify(saleData),
  });
}

export async function submitToZRA(saleId) {
  return apiFetch(`/zra/send-invoice/${saleId}`, { method: 'POST' });
}

// Till-lock (POS Control Phase 1) — the server-committed cart that backs
// the cashier's on-screen cart. See lib/tillLock.js/lib/approval.js.

export async function openTillSession(branchId) {
  return apiFetch('/till/sessions', {
    method: 'POST',
    body: JSON.stringify(branchId ? { branchId } : {}),
  });
}

export async function scanItem(sessionId, { productId, quantity, unitPrice }) {
  return apiFetch(`/till/sessions/${sessionId}/scan`, {
    method: 'POST',
    body: JSON.stringify({ productId, quantity, unitPrice }),
  });
}

export async function reverseLine(sessionId, productId, { toQuantity, approvalId, reasonCode, reasonNote }) {
  return apiFetch(`/till/sessions/${sessionId}/lines/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify({ toQuantity, approvalId, reasonCode, reasonNote }),
  });
}

export async function abandonTillSession(sessionId) {
  return apiFetch(`/till/sessions/${sessionId}`, { method: 'DELETE' });
}

/** Mints a short-lived, action-bound supervisor approval ticket. */
export async function requestApproval({ actionType, credential, method, approverUserId, sessionId, target }) {
  return apiFetch('/till/approvals', {
    method: 'POST',
    body: JSON.stringify({ actionType, credential, method, approverUserId, sessionId, target }),
  });
}

/** id+name only of active users eligible to approve a till action. */
export async function fetchApprovers() {
  return apiFetch('/till/approvers');
}

/** Whether the current user's role may apply/request a discount. */
export async function fetchDiscountPolicy() {
  return apiFetch('/till/discount-policy');
}

// Mock data fallback when API is unavailable
export const mockProducts = [
  { id: 1, name: 'Coca Cola 500ml', price: 8.5, category: 'Beverages', stock: 50 },
  { id: 2, name: 'Bread Loaf', price: 12, category: 'Bakery', stock: 25 },
];

export const mockCategories = [
  { id: 1, name: 'Beverages', color: '#3B82F6' },
  { id: 2, name: 'Bakery', color: '#F59E0B' },
];
