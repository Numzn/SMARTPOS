import React, { useState } from 'react';

const OpenShiftModal = ({ show, onClose, loading, onSubmit }) => {
  const [openingFloat, setOpeningFloat] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  if (!show) return null;

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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-semibold mb-1">Open Shift</h3>
        <p className="text-sm text-gray-500 mb-4">
          Count the cash already in the drawer and enter it as the opening float.
        </p>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Opening Float (K) *</label>
          <input
            type="number"
            min="0"
            step="0.01"
            autoFocus
            value={openingFloat}
            onChange={(e) => setOpeningFloat(e.target.value)}
            placeholder="0.00"
            className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
              error ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional — e.g. handover from previous cashier"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Opening...' : 'Open Shift'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OpenShiftModal;
