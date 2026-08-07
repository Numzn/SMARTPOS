import React from 'react';
import Modal from '../ui/Modal';
import { TextField, TextAreaField } from '../ui/Field';

const EMPTY_SUPPLIER = { name: '', contactPerson: '', phone: '', email: '', tpin: '', address: '', notes: '' };

const SupplierModal = ({ showModal, setShowModal, isEdit, supplierData, setSupplierData, errors, loading, onSubmit }) => {
  const handleClose = () => {
    setShowModal(false);
    setSupplierData(EMPTY_SUPPLIER);
  };

  const set = (key) => (e) => setSupplierData({ ...supplierData, [key]: e.target.value });

  return (
    <Modal
      open={showModal}
      onClose={handleClose}
      title={isEdit ? 'Edit Supplier' : 'Add Supplier'}
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
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Supplier'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TextField
          className="md:col-span-2"
          label="Company Name"
          required
          value={supplierData.name}
          onChange={set('name')}
          error={errors?.name}
        />
        <TextField label="Contact Person" value={supplierData.contactPerson} onChange={set('contactPerson')} />
        <TextField label="Phone" type="tel" value={supplierData.phone} onChange={set('phone')} />
        <TextField label="Email" type="email" value={supplierData.email} onChange={set('email')} />
        <TextField label="TPIN" value={supplierData.tpin} onChange={set('tpin')} />
        <TextField className="md:col-span-2" label="Address" value={supplierData.address} onChange={set('address')} />
        <TextAreaField className="md:col-span-2" label="Notes" value={supplierData.notes} onChange={set('notes')} />
      </div>
    </Modal>
  );
};

export default SupplierModal;
export { EMPTY_SUPPLIER };
