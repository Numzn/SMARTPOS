import React, { useEffect, useState } from 'react';
import Modal from '../../ui/Modal';
import { SelectField, TextField, TextAreaField } from '../../ui/Field';
import { shiftApi } from '../../../services/shiftService';

/**
 * V1 register/till model — the outgoing cashier declares the cash they
 * counted and names who's taking over. Records a HANDOVER declaration and
 * leaves the shift OPEN; it does not close it (only an explicit end/close
 * does that — see useEndShiftFlow, untouched by this).
 */
const HandoverModal = ({ open, onClose, onHandedOver, submitting, error }) => {
  const [candidates, setCandidates] = useState([]);
  const [toUserId, setToUserId] = useState('');
  const [declaredTotal, setDeclaredTotal] = useState('');
  const [notes, setNotes] = useState('');
  const [validationError, setValidationError] = useState('');
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  useEffect(() => {
    if (!open) return;
    setToUserId('');
    setDeclaredTotal('');
    setNotes('');
    setValidationError('');
    setLoadingCandidates(true);
    shiftApi
      .fetchHandoverCandidates()
      .then((list) => setCandidates(list))
      .catch(() => setCandidates([]))
      .finally(() => setLoadingCandidates(false));
  }, [open]);

  const handleSubmit = () => {
    const total = Number(declaredTotal);
    if (!toUserId) {
      setValidationError('Select who is taking over the till');
      return;
    }
    if (!Number.isFinite(total) || total < 0 || declaredTotal === '') {
      setValidationError('Enter the counted cash in the drawer (zero or more)');
      return;
    }
    setValidationError('');
    onHandedOver({ toUserId, declaredTotal: total, notes });
  };

  return (
    <Modal open={open} onClose={onClose} title="Hand Over Till" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Count the cash currently in the drawer, then name who&apos;s taking over. The shift stays open —
          this doesn&apos;t close it.
        </p>

        <SelectField
          label="Handing over to"
          required
          value={toUserId}
          onChange={(e) => setToUserId(e.target.value)}
          disabled={loadingCandidates}
        >
          <option value="">{loadingCandidates ? 'Loading…' : 'Select a cashier'}</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || c.email} ({c.role})
            </option>
          ))}
        </SelectField>

        <TextField
          label="Counted Cash (K)"
          required
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={declaredTotal}
          onChange={(e) => setDeclaredTotal(e.target.value)}
        />

        <TextAreaField
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          hint="Optional — e.g. end of break, shift swap"
        />

        {(validationError || error) && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
            {validationError || error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Handing over…' : 'Hand Over'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default HandoverModal;
