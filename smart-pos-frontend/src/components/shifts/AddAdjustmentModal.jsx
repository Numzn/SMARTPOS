import React, { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import { TextField, TextAreaField } from '../ui/Field';

/**
 * The only way a reconciled variance's story changes after the fact — never
 * touches the original ZReport/CashierDeclaration rows (a separate,
 * additive, audited fact). Gated behind shifts:adjust, a step up from
 * shifts:reconcile — not every reconciler should be able to write off a
 * variance.
 */
const AddAdjustmentModal = ({ show, onClose, loading, onSubmit, shiftLabel, variance }) => {
  const [reason, setReason] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (show) {
      setReason('');
      setResolutionNote('');
      setError('');
    }
  }, [show]);

  const handleSubmit = () => {
    if (!reason.trim()) {
      setError('A reason is required');
      return;
    }
    if (!resolutionNote.trim()) {
      setError('A resolution note is required');
      return;
    }
    setError('');
    onSubmit({ reason: reason.trim(), resolutionNote: resolutionNote.trim() });
  };

  return (
    <Modal
      open={show}
      onClose={onClose}
      title="Add Adjustment"
      description={`${shiftLabel || 'This shift'}${variance != null ? ` — recorded variance K${Number(variance).toFixed(2)}` : ''}. This records a resolution; it never edits the original figures.`}
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
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {loading ? 'Saving…' : 'Add Adjustment'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Reason"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Counting error, cashier reimbursed"
          error={error && !reason.trim() ? error : ''}
        />
        <TextAreaField
          label="Resolution Note"
          required
          value={resolutionNote}
          onChange={(e) => setResolutionNote(e.target.value)}
          placeholder="What was concluded/done about it"
          error={error && reason.trim() && !resolutionNote.trim() ? error : ''}
        />
      </div>
    </Modal>
  );
};

export default AddAdjustmentModal;
