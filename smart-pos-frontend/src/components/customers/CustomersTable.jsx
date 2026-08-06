import React from 'react';

const CustomersTable = ({ customers, onEdit, onDeactivate }) => {
  if (!customers.length) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        No customers yet. Add your first customer to start tracking their purchase history.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">TPIN</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {customers.map((customer) => (
            <tr key={customer.id}>
              <td className="px-4 py-3 text-sm font-medium text-gray-900">{customer.name}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{customer.phone || '—'}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{customer.tpin || '—'}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{customer.email || '—'}</td>
              <td className="px-4 py-3 text-right text-sm">
                <button onClick={() => onEdit(customer)} className="text-blue-600 hover:text-blue-800 mr-3">
                  Edit
                </button>
                <button onClick={() => onDeactivate(customer.id)} className="text-red-600 hover:text-red-800">
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

export default CustomersTable;
