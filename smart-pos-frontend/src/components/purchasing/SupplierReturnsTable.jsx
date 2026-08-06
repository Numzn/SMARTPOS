import React from 'react';

const SupplierReturnsTable = ({ supplierReturns }) => {
  if (!supplierReturns.length) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        No supplier returns recorded yet.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Return Number</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Lines</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Value</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {supplierReturns.map((ret) => (
            <tr key={ret.id}>
              <td className="px-4 py-3 text-sm font-medium text-gray-900">{ret.returnNumber}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{ret.supplier?.name || '—'}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{ret.reason || '—'}</td>
              <td className="px-4 py-3 text-sm text-right text-gray-600">{ret.items?.length || 0}</td>
              <td className="px-4 py-3 text-sm text-right text-gray-700">K{Number(ret.subtotal).toFixed(2)}</td>
              <td className="px-4 py-3 text-sm text-gray-500">{new Date(ret.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default SupplierReturnsTable;
