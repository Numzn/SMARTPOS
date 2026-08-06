import React from 'react';

const EMPTY_CUSTOMER = { name: '', phone: '', email: '', tpin: '', address: '', notes: '' };

const CustomerModal = ({ showModal, setShowModal, isEdit, customerData, setCustomerData, errors, loading, onSubmit }) => {
  if (!showModal) return null;

  const handleClose = () => {
    setShowModal(false);
    setCustomerData(EMPTY_CUSTOMER);
  };

  const field = (key, label, extra = {}) => (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input
        type={extra.type || 'text'}
        value={customerData[key] || ''}
        onChange={(e) => setCustomerData({ ...customerData, [key]: e.target.value })}
        className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
          errors?.[key] ? 'border-red-500' : 'border-gray-300'
        }`}
      />
      {errors?.[key] && <p className="text-red-500 text-xs mt-1">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">{isEdit ? 'Edit Customer' : 'Add Customer'}</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">{field('name', 'Name *')}</div>
          {field('phone', 'Phone')}
          {field('email', 'Email', { type: 'email' })}
          {field('tpin', 'TPIN')}
          <div className="md:col-span-2">{field('address', 'Address')}</div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={customerData.notes || ''}
              onChange={(e) => setCustomerData({ ...customerData, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Customer'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomerModal;
export { EMPTY_CUSTOMER };
