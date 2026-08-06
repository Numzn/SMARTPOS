import React from 'react';

const statusColors = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SENT: 'bg-blue-100 text-blue-700',
  PARTIALLY_RECEIVED: 'bg-yellow-100 text-yellow-700',
  RECEIVED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

const PurchaseOrderDetailModal = ({ show, onClose, po, actionLoading, onEdit, onSend, onCancel, onReceive }) => {
  if (!show || !po) return null;

  const canEdit = po.status === 'DRAFT';
  const canSend = po.status === 'DRAFT';
  const canCancel = po.status === 'DRAFT' || po.status === 'SENT';
  const canReceive = po.status === 'SENT' || po.status === 'PARTIALLY_RECEIVED';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-lg font-semibold">{po.poNumber}</h3>
            <p className="text-sm text-gray-500">{po.supplier?.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs ${statusColors[po.status] || ''}`}>{po.status}</span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        {po.notes && <p className="text-sm text-gray-600 mb-4">{po.notes}</p>}

        <table className="min-w-full text-sm mb-4">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase">
              <th className="py-1">Product</th>
              <th className="py-1 text-right">Ordered</th>
              <th className="py-1 text-right">Received</th>
              <th className="py-1 text-right">Unit Cost</th>
              <th className="py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {po.items.map((item) => (
              <tr key={item.id}>
                <td className="py-2">
                  {item.product?.name} <span className="text-gray-400">({item.product?.sku})</span>
                </td>
                <td className="py-2 text-right">{item.quantityOrdered}</td>
                <td className="py-2 text-right">
                  <span className={item.quantityReceived >= item.quantityOrdered ? 'text-green-600' : ''}>
                    {item.quantityReceived}
                  </span>
                </td>
                <td className="py-2 text-right">K{Number(item.unitCost).toFixed(2)}</td>
                <td className="py-2 text-right">K{Number(item.total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="text-right text-sm font-medium text-gray-800 mb-6">Total: K{Number(po.total).toFixed(2)}</div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
          {canCancel && (
            <button
              onClick={() => onCancel(po)}
              disabled={actionLoading}
              className="px-4 py-2 border border-red-300 text-red-600 rounded-md text-sm font-medium hover:bg-red-50 disabled:opacity-50"
            >
              Cancel PO
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => onEdit(po)}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Edit Draft
            </button>
          )}
          {canSend && (
            <button
              onClick={() => onSend(po)}
              disabled={actionLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Send to Supplier
            </button>
          )}
          {canReceive && (
            <button
              onClick={() => onReceive(po)}
              className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700"
            >
              Receive Stock
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PurchaseOrderDetailModal;
