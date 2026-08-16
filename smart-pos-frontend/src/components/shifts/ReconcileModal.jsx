import React, { useState } from 'react';
import Modal from '../ui/Modal';
import { TextAreaField } from '../ui/Field';
import VarianceBadge from './VarianceBadge';

const money = (n) => `K${Number(n || 0).toFixed(2)}`;

const row = (label, value, opts = {}) => (
  <div className={`flex justify-between px-3 py-2 ${opts.strong ? 'font-semibold' : ''}`}>
    <span className={opts.strong ? '' : 'text-gray-600'}>{label}</span>
    <span className={opts.tone || ''}>{value}</span>
  </div>
);

/**
 * Reconciliation, decoupled: both figures already exist and are read-only
 * by this point — the frozen Z (ZReport.expectedClosingCash) and the
 * cashier's own declaration (CashierDeclaration.declaredTotal), fetched
 * together via GET /shifts/:id/z-report. There is nothing to enter here,
 * only to confirm — replaces the old blind-count-entry flow entirely.
 */
const ReconcileModal = ({ show, onClose, loading, onSubmit, zReport }) => {
  const [notes, setNotes] = useState('');

  const expected = zReport?.expectedClosingCash;
  const declaration = zReport?.declaration;
  const variance =
    declaration && expected != null ? Number((declaration.declaredTotal - expected).toFixed(2)) : null;

  const handleClose = () => {
    setNotes('');
    onClose();
  };

  const handleSubmit = () => {
    onSubmit({ notes });
  };

  return (
    <Modal
      open={show}
      onClose={handleClose}
      title="Reconcile Shift"
      description="Both figures below are already frozen — nothing to enter, just confirm."
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
            disabled={loading || !declaration}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {loading ? 'Reconciling…' : 'Reconcile'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {zReport && (
          <div className="border border-gray-200 rounded-md divide-y divide-gray-100 text-sm">
            {row(`Expected (${zReport.zNumber || 'Z'})`, money(expected), { strong: true })}
            {declaration ? (
              <>
                {row('Cashier declared', money(declaration.declaredTotal))}
                {row(
                  'Variance',
                  <VarianceBadge variance={variance} />,
                  { strong: true }
                )}
              </>
            ) : (
              row('Cashier declared', 'No declaration submitted yet', { tone: 'text-amber-700' })
            )}
          </div>
        )}

        <TextAreaField
          label="Reconciliation Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={variance ? 'Explain the variance if you can (optional)' : 'Optional'}
        />
      </div>
    </Modal>
  );
};

export default ReconcileModal;
