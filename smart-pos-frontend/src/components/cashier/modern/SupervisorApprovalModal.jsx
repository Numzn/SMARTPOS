import React, { useState, useEffect } from 'react';
import Modal from '../../ui/Modal';
import { fetchApprovers, requestApproval } from '../../../api/cashierApi';

const REVERSAL_REASON_CODES = [
  { code: 'CUSTOMER_CHANGED_MIND', label: 'Customer changed mind' },
  { code: 'WRONG_ITEM', label: 'Wrong product' },
  { code: 'DUPLICATE_SCAN', label: 'Duplicate scan' },
  { code: 'PRICING_ERROR', label: 'Pricing error' },
  { code: 'OTHER', label: 'Other' },
];

/**
 * Supervisor step-up (POS Control Phase 1) — collects an approver + PIN
 * (+ reason, for a line reversal) and mints a short-lived, action-bound
 * approval ticket via POST /api/till/approvals. Never hands the raw PIN to
 * anything else; the caller only ever receives the resulting approvalId.
 *
 * actionType: 'LINE_REVERSAL' | 'ORDER_DISCOUNT'
 * target: { productId, quantity } for a reversal, { discountAmount } for a discount
 */
const SupervisorApprovalModal = ({ open, onClose, actionType, sessionId, target, itemLabel, onApproved }) => {
  const [approvers, setApprovers] = useState([]);
  const [approverUserId, setApproverUserId] = useState('');
  const [pin, setPin] = useState('');
  const [reasonCode, setReasonCode] = useState(REVERSAL_REASON_CODES[0].code);
  const [reasonNote, setReasonNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setApproverUserId('');
    setPin('');
    setReasonCode(REVERSAL_REASON_CODES[0].code);
    setReasonNote('');
    setError('');
    fetchApprovers()
      .then((res) => {
        setApprovers(res.approvers || []);
        if (res.approvers?.length === 1) setApproverUserId(res.approvers[0].id);
      })
      .catch(() => setApprovers([]));
  }, [open]);

  const isReversal = actionType === 'LINE_REVERSAL';

  const canSubmit = approverUserId && /^\d{4,6}$/.test(pin) && (!isReversal || reasonCode);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await requestApproval({
        actionType,
        credential: pin,
        method: 'PIN',
        approverUserId,
        sessionId,
        target,
      });
      onApproved({ approvalId: res.approvalId, reasonCode, reasonNote });
    } catch (err) {
      setError(err?.data?.error || err.message || 'Approval failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isReversal ? 'Supervisor approval — reverse item' : 'Supervisor approval — discount'}
      description={itemLabel}
      size="sm"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {submitting ? 'Verifying…' : 'Approve'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Supervisor</span>
          <select
            value={approverUserId}
            onChange={(e) => setApproverUserId(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="">Select who is approving…</option>
            {approvers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id} ({a.role})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Supervisor PIN</span>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
            autoFocus
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono tracking-widest"
          />
          <span className="text-xs text-gray-500">Hand the device to the supervisor to enter their PIN.</span>
        </label>

        {isReversal && (
          <div className="grid grid-cols-1 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Reason</span>
              <select
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                {REVERSAL_REASON_CODES.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Notes (optional)</span>
              <input
                type="text"
                value={reasonNote}
                onChange={(e) => setReasonNote(e.target.value)}
                placeholder="Additional detail"
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </label>
          </div>
        )}

        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>
        )}
      </div>
    </Modal>
  );
};

export default SupervisorApprovalModal;
