import React, { useState } from 'react';
import { Wallet } from 'lucide-react';
import { TextField, TextAreaField } from '../ui/Field';

/**
 * Blocks normal till operation until the cashier confirms the physical cash
 * they counted into the drawer — rendered inline (not a dismissable modal:
 * there is nothing to cancel back to, since the shift already exists in
 * INITIALIZING and the only way forward is to confirm it). Same fields as
 * the old manual OpenShiftModal, just no longer optional/manual.
 */
const OpeningCashPrompt = ({ shiftNumber, confirming, error, onConfirm }) => {
  const [openingFloat, setOpeningFloat] = useState('');
  const [notes, setNotes] = useState('');
  const [validationError, setValidationError] = useState('');

  const handleConfirm = () => {
    const value = Number(openingFloat);
    if (!Number.isFinite(value) || value < 0 || openingFloat === '') {
      setValidationError('Enter the counted opening cash (zero or more)');
      return;
    }
    setValidationError('');
    onConfirm({ openingFloat: value, notes });
  };

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-xl border shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2 text-gray-900">
          <Wallet className="w-5 h-5" strokeWidth={1.75} />
          <h2 className="text-lg font-semibold">Opening Cash</h2>
        </div>
        <p className="text-sm text-gray-500">
          Count the physical cash placed in your drawer for {shiftNumber || 'this shift'} before you can start
          selling.
        </p>

        <TextField
          label="Opening Cash (K)"
          required
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={openingFloat}
          onChange={(e) => setOpeningFloat(e.target.value)}
          error={validationError}
        />
        <TextAreaField
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          hint="Optional — e.g. handover from previous cashier"
        />

        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirming}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {confirming ? 'Confirming…' : 'Confirm Opening Balance'}
        </button>
      </div>
    </div>
  );
};

export default OpeningCashPrompt;
