import { apiFetch } from '../lib/apiClient';

export const purchaseOrderApi = {
  fetchPurchaseOrders: async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const data = await apiFetch(`/purchase-orders${qs ? `?${qs}` : ''}`);
    return data.purchaseOrders || [];
  },

  fetchPurchaseOrder: async (id) => {
    const data = await apiFetch(`/purchase-orders/${id}`);
    return data.purchaseOrder;
  },

  fetchGrnsForPo: async (id) => {
    const data = await apiFetch(`/purchase-orders/${id}/grns`);
    return data.goodsReceivedNotes || [];
  },

  createPurchaseOrder: (poData) =>
    apiFetch('/purchase-orders', { method: 'POST', body: JSON.stringify(poData) }),

  updatePurchaseOrder: (id, poData) =>
    apiFetch(`/purchase-orders/${id}`, { method: 'PUT', body: JSON.stringify(poData) }),

  sendPurchaseOrder: (id) => apiFetch(`/purchase-orders/${id}/send`, { method: 'POST' }),

  cancelPurchaseOrder: (id) => apiFetch(`/purchase-orders/${id}/cancel`, { method: 'POST' }),

  receiveAgainstPurchaseOrder: (id, payload) =>
    apiFetch(`/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify(payload) }),
};

export const grnApi = {
  fetchGrns: async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const data = await apiFetch(`/goods-received-notes${qs ? `?${qs}` : ''}`);
    return data.goodsReceivedNotes || [];
  },

  fetchGrn: async (id) => {
    const data = await apiFetch(`/goods-received-notes/${id}`);
    return data.goodsReceivedNote;
  },
};

export const supplierReturnApi = {
  fetchReturns: async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const data = await apiFetch(`/supplier-returns${qs ? `?${qs}` : ''}`);
    return data.supplierReturns || [];
  },

  fetchReturn: async (id) => {
    const data = await apiFetch(`/supplier-returns/${id}`);
    return data.supplierReturn;
  },

  createReturn: (returnData) =>
    apiFetch('/supplier-returns', { method: 'POST', body: JSON.stringify(returnData) }),
};
