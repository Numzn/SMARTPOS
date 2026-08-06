import React from 'react';

const SuppliersTable = ({ suppliers, onEdit, onDeactivate, onViewHistory }) => {
  if (!suppliers.length) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        No suppliers yet. Add a supplier before raising a purchase order.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contact</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">TPIN</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {suppliers.map((supplier) => (
            <tr key={supplier.id}>
              <td className="px-4 py-3 text-sm font-medium text-gray-900">{supplier.name}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{supplier.contactPerson || '—'}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{supplier.phone || '—'}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{supplier.tpin || '—'}</td>
              <td className="px-4 py-3 text-right text-sm">
                <button onClick={() => onViewHistory(supplier)} className="text-gray-600 hover:text-gray-800 mr-3">
                  History
                </button>
                <button onClick={() => onEdit(supplier)} className="text-blue-600 hover:text-blue-800 mr-3">
                  Edit
                </button>
                <button onClick={() => onDeactivate(supplier.id)} className="text-red-600 hover:text-red-800">
                  Deactivate
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default SuppliersTable;
