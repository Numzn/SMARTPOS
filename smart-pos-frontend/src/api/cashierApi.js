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

// Mock data fallback when API is unavailable
export const mockProducts = [
  { id: 1, name: 'Coca Cola 500ml', price: 8.5, category: 'Beverages', stock: 50 },
  { id: 2, name: 'Bread Loaf', price: 12, category: 'Bakery', stock: 25 },
];

export const mockCategories = [
  { id: 1, name: 'Beverages', color: '#3B82F6' },
  { id: 2, name: 'Bakery', color: '#F59E0B' },
];
