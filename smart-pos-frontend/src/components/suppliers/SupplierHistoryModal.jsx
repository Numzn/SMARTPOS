import React from 'react';

const statusColors = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SENT: 'bg-blue-100 text-blue-700',
  PARTIALLY_RECEIVED: 'bg-yellow-100 text-yellow-700',
  RECEIVED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

const SupplierHistoryModal = ({ show, onClose, supplier, history, loading }) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Purchase history — {supplier?.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            ✕
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-gray-500 py-8 text-center">Loading...</div>
        ) : (
          <>
            <h4 className="font-medium text-gray-700 mb-2">Purchase Orders</h4>
            {!history?.purchaseOrders?.length ? (
              <p className="text-sm text-gray-500 mb-4">No purchase orders yet.</p>
            ) : (
              <table className="min-w-full text-sm mb-6">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase">
                    <th className="py-1">PO Number</th>
                    <th className="py-1">Status</th>
                    <th className="py-1">Total</th>
                    <th className="py-1">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.purchaseOrders.map((po) => (
                    <tr key={po.id}>
                      <td className="py-2 font-medium">{po.poNumber}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${statusColors[po.status] || ''}`}>
                          {po.status}
                        </span>
                      </td>
                      <td className="py-2">K{Number(po.total).toFixed(2)}</td>
                      <td className="py-2 text-gray-500">{new Date(po.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h4 className="font-medium text-gray-700 mb-2">Goods Received</h4>
            {!history?.goodsReceivedNotes?.length ? (
              <p className="text-sm text-gray-500">No deliveries received yet.</p>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase">
                    <th className="py-1">GRN Number</th>
                    <th className="py-1">Items</th>
                    <th className="py-1">Received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.goodsReceivedNotes.map((grn) => (
                    <tr key={grn.id}>
                      <td className="py-2 font-medium">{grn.grnNumber}</td>
                      <td className="py-2">{grn.items?.length || 0} line(s)</td>
                      <td className="py-2 text-gray-500">{new Date(grn.receivedDate).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SupplierHistoryModal;
