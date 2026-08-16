import React, { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import { TextField } from '../ui/Field';

/**
 * The cashier's own physical cash count for their own just-ended shift —
 * back office / shared terminal only, never the POS till itself (the whole
 * point of decoupling: counting happens after the Z is already frozen, not
 * before). Deliberately does not show expected cash or any prior figure —
 * that would defeat the point of an independent count. Immutable once
 * submitted; a correction afterward is a ShiftAdjustment, not a re-submit.
 */
const SubmitDeclarationModal = ({ show, shiftLabel, onClose, loading, onSubmit }) => {
  const [declaredTotal, setDeclaredTotal] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (show) {
      setDeclaredTotal('');
      setError('');
    }
  }, [show]);

  const handleSubmit = () => {
    const value = Number(declaredTotal);
    if (!Number.isFinite(value) || value < 0 || declaredTotal === '') {
      setError('Enter the counted cash total (zero or more)');
      return;
    }
    setError('');
    onSubmit({ declaredTotal: value });
  };

  return (
    <Modal
      open={show}
      onClose={onClose}
      title="Submit Declaration"
      description={`Count the physical cash from ${shiftLabel || 'this shift'} and enter the total. This is submitted once and can't be edited afterward.`}
      size="sm"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {loading ? 'Submitting…' : 'Submit Declaration'}
          </button>
        </>
      }
    >
      <TextField
        label="Counted Cash (K)"
        required
        type="number"
        min="0"
        step="0.01"
        placeholder="0.00"
        value={declaredTotal}
        onChange={(e) => setDeclaredTotal(e.target.value)}
        error={error}
      />
    </Modal>
  );
};

export default SubmitDeclarationModal;
