import React from 'react';

const GoodsReceivedNotesTable = ({ goodsReceivedNotes }) => {
  if (!goodsReceivedNotes.length) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        No deliveries recorded yet. Goods received notes are created automatically when you receive stock
        against a purchase order.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">GRN Number</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">PO Number</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Lines</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Received</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {goodsReceivedNotes.map((grn) => (
            <tr key={grn.id}>
              <td className="px-4 py-3 text-sm font-medium text-gray-900">{grn.grnNumber}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{grn.supplier?.name || '—'}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{grn.purchaseOrder?.poNumber || '—'}</td>
              <td className="px-4 py-3 text-sm text-right text-gray-600">{grn.items?.length || 0}</td>
              <td className="px-4 py-3 text-sm text-gray-500">{new Date(grn.receivedDate).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default GoodsReceivedNotesTable;
