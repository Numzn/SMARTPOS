import React from 'react';
import Modal from '../ui/Modal';
import { TextField, TextAreaField } from '../ui/Field';

const EMPTY_CUSTOMER = { name: '', phone: '', email: '', tpin: '', address: '', notes: '' };

const CustomerModal = ({ showModal, setShowModal, isEdit, customerData, setCustomerData, errors, loading, onSubmit }) => {
  const handleClose = () => {
    setShowModal(false);
    setCustomerData(EMPTY_CUSTOMER);
  };

  const set = (key) => (e) => setCustomerData({ ...customerData, [key]: e.target.value });

  return (
    <Modal
      open={showModal}
      onClose={handleClose}
      title={isEdit ? 'Edit Customer' : 'Add Customer'}
      size="md"
      footer={
        <>
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Customer'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TextField
          className="md:col-span-2"
          label="Name"
          required
          value={customerData.name}
          onChange={set('name')}
          error={errors?.name}
        />
        <TextField label="Phone" type="tel" value={customerData.phone} onChange={set('phone')} error={errors?.phone} />
        <TextField label="Email" type="email" value={customerData.email} onChange={set('email')} error={errors?.email} />
        <TextField label="TPIN" value={customerData.tpin} onChange={set('tpin')} error={errors?.tpin} />
        <TextField className="md:col-span-2" label="Address" value={customerData.address} onChange={set('address')} />
        <TextAreaField
          className="md:col-span-2"
          label="Notes"
          value={customerData.notes}
          onChange={set('notes')}
        />
      </div>
    </Modal>
  );
};

export default CustomerModal;
export { EMPTY_CUSTOMER };
