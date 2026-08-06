import React, { useState } from 'react';

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

  if (!show) return null;

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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-1">Close Shift</h3>
        <p className="text-sm text-gray-500 mb-4">
          Count the physical cash in the drawer and enter the total. The expected figure is
          revealed after you commit your count.
        </p>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Counted Cash (K) *</label>
          <input
            type="number"
            min="0"
            step="0.01"
            autoFocus
            disabled={revealed}
            value={countedCash}
            onChange={(e) => setCountedCash(e.target.value)}
            placeholder="0.00"
            className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 ${
              error ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
        </div>

        {!revealed ? (
          <button
            onClick={handleReveal}
            className="w-full mb-6 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Commit count &amp; show variance
          </button>
        ) : (
          <div className="mb-6 border border-gray-200 rounded-md divide-y divide-gray-100 text-sm">
            {breakdown && (
              <>
                <div className="flex justify-between px-3 py-2">
                  <span className="text-gray-600">Opening float</span>
                  <span>{money(breakdown.openingFloat)}</span>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <span className="text-gray-600">Cash sales</span>
                  <span>{money(breakdown.cashSales)}</span>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <span className="text-gray-600">Cash refunds</span>
                  <span>-{money(breakdown.cashRefunds)}</span>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <span className="text-gray-600">Cash in</span>
                  <span>{money(breakdown.cashIn)}</span>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <span className="text-gray-600">Cash out</span>
                  <span>-{money(breakdown.cashOut)}</span>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <span className="text-gray-600">Paid out</span>
                  <span>-{money(breakdown.paidOut)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between px-3 py-2 font-medium">
              <span>Expected in drawer</span>
              <span>{money(expectedCash)}</span>
            </div>
            <div className="flex justify-between px-3 py-2">
              <span className="text-gray-600">You counted</span>
              <span>{money(counted)}</span>
            </div>
            <div className={`flex justify-between px-3 py-2 font-semibold ${varianceTone}`}>
              <span>
                Variance
                {variance !== null && variance !== 0 && (
                  <span className="font-normal text-gray-500">
                    {variance > 0 ? ' (over)' : ' (short)'}
                  </span>
                )}
              </span>
              <span>{money(variance)}</span>
            </div>
          </div>
        )}

        <div className="mb-6">
          <label className="block text-sm font-medium mb-1">Closing Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={
              variance !== null && variance !== 0
                ? 'Explain the variance if you can'
                : 'Optional'
            }
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
            disabled={loading || !revealed}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? 'Closing...' : 'Close Shift'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CloseShiftModal;
