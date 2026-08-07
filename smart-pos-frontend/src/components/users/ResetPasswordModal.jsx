import React, { useState, useEffect } from 'react';
import Modal from '../ui/Modal';
import { TextField } from '../ui/Field';

/**
 * Two paths: let the server generate a temporary password, or set one
 * explicitly. Either way the resulting password is shown once, afterwards —
 * it is stored hashed, so if the admin doesn't capture it here it cannot be
 * retrieved and the reset has to be repeated.
 */
const ResetPasswordModal = ({ show, user, onClose, loading, onSubmit, issuedPassword }) => {
  const [mode, setMode] = useState('generate');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (show) {
      setMode('generate');
      setPassword('');
      setError('');
      setCopied(false);
    }
  }, [show, user?.id]);

  const handleSubmit = () => {
    if (mode === 'manual') {
      if (!password || password.length < 8) {
        setError('Password must be at least 8 characters');
        return;
      }
    }
    setError('');
    onSubmit(mode === 'manual' ? password : undefined);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issuedPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal
      open={show}
      onClose={onClose}
      title={issuedPassword ? 'Password reset' : `Reset password — ${user?.name || user?.email || ''}`}
      size="sm"
      footer={
        issuedPassword ? (
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
              {loading ? 'Resetting…' : 'Reset Password'}
            </button>
          </>
        )
      }
    >
      {issuedPassword ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Give this to <strong>{user?.name || user?.email}</strong> now. It is stored hashed and
            cannot be shown again — you would have to reset it a second time.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-gray-100 rounded font-mono text-sm break-all">
              {issuedPassword}
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
            <legend className="text-sm font-medium text-gray-700 mb-2">How should the password be set?</legend>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="reset-mode"
                  value="generate"
                  checked={mode === 'generate'}
                  onChange={() => setMode('generate')}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">Generate one for me</span>
                  <span className="block text-xs text-gray-500">
                    Shown once after resetting, so you can pass it on
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="reset-mode"
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
              label="New password"
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error}
              hint="At least 8 characters"
            />
          )}
          {mode === 'generate' && error && <p className="text-red-600 text-xs">{error}</p>}
        </div>
      )}
    </Modal>
  );
};

export default ResetPasswordModal;
