import { apiFetch } from '../lib/apiClient';

export const supplierApi = {
  fetchSuppliers: async (q = '') => {
    const data = await apiFetch(`/suppliers${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    return data.suppliers || [];
  },

  fetchSupplier: async (id) => {
    const data = await apiFetch(`/suppliers/${id}`);
    return data.supplier;
  },

  fetchPurchaseHistory: (id) => apiFetch(`/suppliers/${id}/purchase-history`),

  createSupplier: (supplierData) =>
    apiFetch('/suppliers', { method: 'POST', body: JSON.stringify(supplierData) }),

  updateSupplier: (id, supplierData) =>
    apiFetch(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(supplierData) }),

  deactivateSupplier: (id) => apiFetch(`/suppliers/${id}`, { method: 'DELETE' }),
};
