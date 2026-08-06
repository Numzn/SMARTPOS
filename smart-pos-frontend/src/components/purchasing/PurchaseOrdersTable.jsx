import React from 'react';

const statusColors = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SENT: 'bg-blue-100 text-blue-700',
  PARTIALLY_RECEIVED: 'bg-yellow-100 text-yellow-700',
  RECEIVED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

const PurchaseOrdersTable = ({ purchaseOrders, onView }) => {
  if (!purchaseOrders.length) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        No purchase orders yet. Create one to start ordering stock from a supplier.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">PO Number</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {purchaseOrders.map((po) => (
            <tr key={po.id}>
              <td className="px-4 py-3 text-sm font-medium text-gray-900">{po.poNumber}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{po.supplier?.name || '—'}</td>
              <td className="px-4 py-3 text-sm">
                <span className={`px-2 py-0.5 rounded text-xs ${statusColors[po.status] || ''}`}>{po.status}</span>
              </td>
              <td className="px-4 py-3 text-sm text-right text-gray-700">K{Number(po.total).toFixed(2)}</td>
              <td className="px-4 py-3 text-sm text-gray-500">{new Date(po.createdAt).toLocaleDateString()}</td>
              <td className="px-4 py-3 text-right text-sm">
                <button onClick={() => onView(po)} className="text-blue-600 hover:text-blue-800">
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default PurchaseOrdersTable;
