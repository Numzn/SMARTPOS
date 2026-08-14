import React, { useState, useEffect } from 'react';
import Modal from '../ui/Modal';
import { TextField } from '../ui/Field';

/**
 * Sets/resets a supervisor step-up PIN (POS Control Phase 1) — the
 * credential a SUPERVISOR/MANAGER/ADMIN enters at the till to approve a
 * cashier's line reversal or over-threshold discount. Mirrors
 * ResetPasswordModal.jsx's generate-or-set-manually pattern exactly: shown
 * once after setting, since it's stored hashed and cannot be retrieved again.
 */
const SetPinModal = ({ show, user, onClose, loading, onSubmit, issuedPin }) => {
  const [mode, setMode] = useState('generate');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (show) {
      setMode('generate');
      setPin('');
      setError('');
      setCopied(false);
    }
  }, [show, user?.id]);

  const handleSubmit = () => {
    if (mode === 'manual') {
      if (!/^\d{4,6}$/.test(pin)) {
        setError('PIN must be 4-6 digits');
        return;
      }
    }
    setError('');
    onSubmit(mode === 'manual' ? pin : undefined);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issuedPin);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal
      open={show}
      onClose={onClose}
      title={issuedPin ? 'PIN set' : `Set supervisor PIN — ${user?.name || user?.email || ''}`}
      size="sm"
      footer={
        issuedPin ? (
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Done
          </button>
        ) : (
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
              className="px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              {loading ? 'Setting…' : 'Set PIN'}
            </button>
          </>
        )
      }
    >
      {issuedPin ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Give this to <strong>{user?.name || user?.email}</strong> now. It is stored hashed and
            cannot be shown again — you would have to set it a second time.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-gray-100 rounded font-mono text-lg tracking-widest text-center">
              {issuedPin}
            </code>
            <button
              onClick={copy}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <fieldset>
            <legend className="text-sm font-medium text-gray-700 mb-2">How should the PIN be set?</legend>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="pin-mode"
                  value="generate"
                  checked={mode === 'generate'}
                  onChange={() => setMode('generate')}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">Generate one for me</span>
                  <span className="block text-xs text-gray-500">
                    Shown once after setting, so you can pass it on
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="pin-mode"
                  value="manual"
                  checked={mode === 'manual'}
                  onChange={() => setMode('manual')}
                  className="mt-1"
                />
                <span className="font-medium">Set it myself</span>
              </label>
            </div>
          </fieldset>

          {mode === 'manual' && (
            <TextField
              label="New PIN"
              required
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              error={error}
              hint="4-6 digits"
            />
          )}
          {mode === 'generate' && error && <p className="text-red-600 text-xs">{error}</p>}
        </div>
      )}
    </Modal>
  );
};

export default SetPinModal;
