import React, { useState, useEffect } from 'react';
import Modal from '../ui/Modal';
import { TextField } from '../ui/Field';

const MOVEMENT_LABELS = {
  CASH_IN: {
    title: 'Cash In',
    blurb: 'Money added to the drawer that is not a sale — e.g. a float top-up.',
    verb: 'Record Cash In',
  },
  CASH_OUT: {
    title: 'Cash Out',
    blurb: 'Money removed from the drawer — e.g. a mid-day bank drop.',
    verb: 'Record Cash Out',
  },
  PAID_OUT: {
    title: 'Paid Out',
    blurb: 'Cash paid from the drawer for an expense — e.g. a delivery or supplies.',
    verb: 'Record Paid Out',
  },
  SAFE_DROP: {
    title: 'Safe Drop',
    blurb: 'Cash moved to the safe — its own reporting line, separate from an ordinary payout.',
    verb: 'Record Safe Drop',
  },
};

const CashMovementModal = ({ show, type, onClose, loading, onSubmit }) => {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  // Reset between openings so a previous entry never carries into a new one.
  useEffect(() => {
    if (show) {
      setAmount('');
      setReason('');
      setError('');
    }
  }, [show, type]);

  const copy = MOVEMENT_LABELS[type];

  const handleSubmit = () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Amount must be greater than zero');
      return;
    }
    setError('');
    onSubmit({ amount: value, reason });
  };

  return (
    <Modal
      open={Boolean(show && type)}
      onClose={onClose}
      title={copy?.title}
      description={copy?.blurb}
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
            {loading ? 'Saving…' : copy?.verb}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Amount (K)"
          required
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={error}
        />
        <TextField
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Optional but recommended"
        />
      </div>
    </Modal>
  );
};

export default CashMovementModal;
