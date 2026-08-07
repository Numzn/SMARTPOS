import React, { useState } from 'react';
import Modal from '../ui/Modal';
import { TextField, TextAreaField, LiveStatus } from '../ui/Field';

const money = (n) => `K${Number(n || 0).toFixed(2)}`;

/**
 * Blind count: the expected drawer total and resulting variance stay hidden
 * until the cashier commits a counted figure. Showing the target first would
 * let a short drawer simply be typed away, which defeats the point of the
 * count. The backend recomputes expectedCash itself on close, so this is a
 * UI-side control only — the figure shown here is a preview, not the source
 * of truth.
 */
const CloseShiftModal = ({ show, onClose, loading, onSubmit, expectedCash, breakdown }) => {
  const [countedCash, setCountedCash] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState(false);

  const counted = Number(countedCash);
  const countIsValid = Number.isFinite(counted) && counted >= 0 && countedCash !== '';
  const variance = countIsValid ? Number((counted - (expectedCash || 0)).toFixed(2)) : null;

  const handleReveal = () => {
    if (!countIsValid) {
      setError('Enter the counted cash amount first');
      return;
    }
    setError('');
    setRevealed(true);
  };

  const handleSubmit = () => {
    if (!countIsValid) {
      setError('Counted cash must be zero or more');
      return;
    }
    setError('');
    onSubmit({ countedCash: counted, notes });
  };

  const handleClose = () => {
    setCountedCash('');
    setNotes('');
    setError('');
    setRevealed(false);
    onClose();
  };

  const varianceTone =
    variance === null || variance === 0
      ? 'text-gray-900'
      : variance > 0
        ? 'text-blue-700'
        : 'text-red-700';

  const row = (label, value, opts = {}) => (
    <div className={`flex justify-between px-3 py-2 ${opts.strong ? 'font-semibold' : ''}`}>
      <span className={opts.strong ? '' : 'text-gray-600'}>{label}</span>
      <span className={opts.tone || ''}>{value}</span>
    </div>
  );

  return (
    <Modal
      open={show}
      onClose={handleClose}
      title="Close Shift"
      description="Count the physical cash in the drawer and enter the total. The expected figure is revealed after you commit your count."
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
            onClick={handleSubmit}
            disabled={loading || !revealed}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {loading ? 'Closing…' : 'Close Shift'}
          </button>
        </>
      }
    >
      <LiveStatus
        message={
          revealed && variance !== null
            ? `Expected ${money(expectedCash)}, counted ${money(counted)}, variance ${money(variance)}`
            : ''
        }
      />

      <div className="space-y-4">
        <TextField
          label="Counted Cash (K)"
          required
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          disabled={revealed}
          value={countedCash}
          onChange={(e) => setCountedCash(e.target.value)}
          error={error}
        />

        {!revealed ? (
          <button
            onClick={handleReveal}
            className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Commit count &amp; show variance
          </button>
        ) : (
          <div className="border border-gray-200 rounded-md divide-y divide-gray-100 text-sm">
            {breakdown && (
              <>
                {row('Opening float', money(breakdown.openingFloat))}
                {row('Cash sales', money(breakdown.cashSales))}
                {row('Cash refunds', `-${money(breakdown.cashRefunds)}`)}
                {row('Cash in', money(breakdown.cashIn))}
                {row('Cash out', `-${money(breakdown.cashOut)}`)}
                {row('Paid out', `-${money(breakdown.paidOut)}`)}
              </>
            )}
            {row('Expected in drawer', money(expectedCash), { strong: true })}
            {row('You counted', money(counted))}
            {row(
              `Variance${variance !== null && variance !== 0 ? (variance > 0 ? ' (over)' : ' (short)') : ''}`,
              money(variance),
              { strong: true, tone: varianceTone }
            )}
          </div>
        )}

        <TextAreaField
          label="Closing Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={variance !== null && variance !== 0 ? 'Explain the variance if you can' : 'Optional'}
        />
      </div>
    </Modal>
  );
};

export default CloseShiftModal;
