import React, { useState, useEffect } from 'react';

const ReceiveAgainstPoModal = ({ show, onClose, po, loading, onSubmit }) => {
  const [quantities, setQuantities] = useState({});

  useEffect(() => {
    if (!po) return;
    const initial = {};
    po.items.forEach((item) => {
      const remaining = item.quantityOrdered - item.quantityReceived;
      initial[item.id] = remaining > 0 ? remaining : 0;
    });
    setQuantities(initial);
  }, [po]);

  if (!show || !po) return null;

  const pendingItems = po.items.filter((item) => item.quantityOrdered - item.quantityReceived > 0);

  const handleSubmit = () => {
    const items = pendingItems
      .map((item) => ({ purchaseOrderItemId: item.id, quantity: Number(quantities[item.id]) || 0 }))
      .filter((line) => line.quantity > 0);
    onSubmit(items);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-1">Receive Stock — {po.poNumber}</h3>
        <p className="text-sm text-gray-500 mb-4">
          Enter the quantity actually delivered for each line. Leave at 0 to skip a line for this delivery.
        </p>

        {pendingItems.length === 0 ? (
          <p className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-md p-4 text-center">
            All lines on this order have already been fully received.
          </p>
        ) : (
          <table className="min-w-full text-sm mb-6">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase">
                <th className="py-1">Product</th>
                <th className="py-1 text-right">Remaining</th>
                <th className="py-1 text-right w-32">Receive Now</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pendingItems.map((item) => {
                const remaining = item.quantityOrdered - item.quantityReceived;
                return (
                  <tr key={item.id}>
                    <td className="py-2">
                      {item.product?.name} <span className="text-gray-400">({item.product?.sku})</span>
                    </td>
                    <td className="py-2 text-right">{remaining}</td>
                    <td className="py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        max={remaining}
                        value={quantities[item.id] ?? 0}
                        onChange={(e) => setQuantities({ ...quantities, [item.id]: e.target.value })}
                        className="w-24 px-2 py-1 border border-gray-300 rounded-md text-right"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || pendingItems.length === 0}
            className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'Receiving...' : 'Confirm Receipt'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReceiveAgainstPoModal;
