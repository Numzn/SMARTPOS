// Centralized API service for cashier dashboard (aligned with backend auth)
import Cookies from 'js-cookie';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

function getAuthHeaders() {
  const token = Cookies.get('token') || localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchProducts() {
  const res = await fetch(`${API_BASE}/products`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to fetch products');
  return res.json();
}

export async function fetchCategories() {
  const res = await fetch(`${API_BASE}/categories`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to fetch categories');
  return res.json();
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

export async function createSale(saleData) {
  const res = await fetch(`${API_BASE}/sales`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(saleData),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create sale');
  }
  return res.json();
}

export async function submitToZRA(saleId) {
  const res = await fetch(`${API_BASE}/zra/send-invoice/${saleId}`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to submit to ZRA');
  }
  return res.json();
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
