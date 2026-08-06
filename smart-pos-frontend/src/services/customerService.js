import { apiFetch } from '../lib/apiClient';

export const customerApi = {
  fetchCustomers: async (q = '') => {
    const data = await apiFetch(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    return data.customers || [];
  },

  fetchCustomer: async (id) => {
    const data = await apiFetch(`/customers/${id}`);
    return data.customer;
  },

  fetchSalesHistory: async (id) => {
    const data = await apiFetch(`/customers/${id}/sales-history`);
    return data.sales || [];
  },

  createCustomer: (customerData) =>
    apiFetch('/customers', { method: 'POST', body: JSON.stringify(customerData) }),

  updateCustomer: (id, customerData) =>
    apiFetch(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(customerData) }),

  deactivateCustomer: (id) => apiFetch(`/customers/${id}`, { method: 'DELETE' }),
};
