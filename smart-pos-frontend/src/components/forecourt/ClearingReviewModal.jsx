import React, { useState } from 'react';
import Modal from '../ui/Modal';
import { TextAreaField } from '../ui/Field';

const money = (n) => `K${Number(n || 0).toFixed(2)}`;

/**
 * Follows components/shifts/ReconcileModal.jsx's shape: the caller already
 * computed the review data (reviewData), this only renders it read-only
 * plus one optional field, then calls onSubmit. No settlement backend
 * exists yet (AttendantSettlement/SettlementBatch are schema-only) — the
 * caller's onSubmit is a local, in-memory mark-as-settled, not an API
 * call, so this is explicit about not persisting anything.
 */
const ClearingReviewModal = ({ open, onClose, loading = false, onSubmit, reviewData }) => {
  const [notes, setNotes] = useState('');

  const handleClose = () => {
    setNotes('');
    onClose();
  };

  const handleSubmit = () => {
    onSubmit({ notes });
    setNotes('');
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Review Clearing"
      description="Not yet saved to the server — settlement backend lands in a later phase. This only updates what you see here."
      size="md"
      footer={
        <>
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !reviewData || reviewData.count === 0}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Clearing…' : 'Confirm Clearing'}
          </button>
        </>
      }
    >
      {reviewData && (
        <div className="space-y-4">
          <div className="border border-gray-200 rounded-md divide-y divide-gray-100 text-sm">
            {reviewData.attendantBreakdown.map(({ attendant, count, total }) => (
              <div key={attendant?.id || attendant?.name} className="flex justify-between px-3 py-2">
                <span className="text-gray-600">
                  {attendant?.name || 'Unknown'} <span className="text-gray-400">{attendant?.attendantCode}</span> ·{' '}
                  {count} txn{count === 1 ? '' : 's'}
                </span>
                <span>{money(total)}</span>
              </div>
            ))}
            <div className="flex justify-between px-3 py-2 font-semibold">
              <span>Total</span>
              <span>{money(reviewData.total)}</span>
            </div>
          </div>

          <TextAreaField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </div>
      )}
    </Modal>
  );
};

export default ClearingReviewModal;
