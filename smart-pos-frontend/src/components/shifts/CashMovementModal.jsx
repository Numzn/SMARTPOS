import React, { useState, useEffect } from 'react';

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

  if (!show || !type) return null;

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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-semibold mb-1">{copy.title}</h3>
        <p className="text-sm text-gray-500 mb-4">{copy.blurb}</p>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Amount (K) *</label>
          <input
            type="number"
            min="0"
            step="0.01"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
              error ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium mb-1">Reason</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional but recommended"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Saving...' : copy.verb}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CashMovementModal;
