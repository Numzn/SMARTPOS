import React, { useState } from 'react';
import Modal from '../ui/Modal';
import { TextField, TextAreaField } from '../ui/Field';

const OpenShiftModal = ({ show, onClose, loading, onSubmit }) => {
  const [openingFloat, setOpeningFloat] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const float = Number(openingFloat);
    if (!Number.isFinite(float) || float < 0) {
      setError('Opening float must be zero or more');
      return;
    }
    setError('');
    onSubmit({ openingFloat: float, notes });
  };

  const handleClose = () => {
    setOpeningFloat('');
    setNotes('');
    setError('');
    onClose();
  };

  return (
    <Modal
      open={show}
      onClose={handleClose}
      title="Open Shift"
      description="Count the cash already in the drawer and enter it as the opening float."
      size="sm"
      footer={
        <>
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {loading ? 'Opening…' : 'Open Shift'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Opening Float (K)"
          required
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={openingFloat}
          onChange={(e) => setOpeningFloat(e.target.value)}
          error={error}
        />
        <TextAreaField
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          hint="Optional — e.g. handover from previous cashier"
        />
      </div>
    </Modal>
  );
};

export default OpenShiftModal;
