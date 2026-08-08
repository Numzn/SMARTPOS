import React, { useState, useRef } from 'react';
import Modal from '../ui/Modal';
import { inventoryImportApi } from '../../services/inventoryImportService';

const ACTION_STYLES = {
  increase: 'bg-green-100 text-green-700',
  decrease: 'bg-amber-100 text-amber-800',
  unchanged: 'bg-gray-100 text-gray-600',
  error: 'bg-red-100 text-red-700',
};

/**
 * Stock take import: preview, then apply.
 *
 * Unlike the product importer this does not set values — each differing row
 * raises a stock adjustment, so the change appears in the ledger and the ZRA
 * audit trail. The preview therefore shows the delta, not the new value: what
 * is on hand, what was counted, and what will move.
 */
const StockTakeImportModal = ({ show, onClose, onImported, branchId = 'main' }) => {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [plan, setPlan] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const fileRef = useRef(null);

  const reset = () => {
    setCsv('');
    setFileName('');
    setPlan(null);
    setReason('');
    setError('');
    setDone(null);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setPlan(null);
    setDone(null);
    setFileName(file.name);
    setCsv(await file.text());
  };

  const handlePreview = async () => {
    setBusy(true);
    setError('');
    try {
      setPlan(await inventoryImportApi.preview(csv, branchId));
    } catch (err) {
      setError(err?.data?.error || err.message || 'Could not read that file');
      setPlan(err?.data?.plan || null);
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await inventoryImportApi.commit(csv, branchId, reason);
      setDone(result);
      onImported?.();
    } catch (err) {
      setError(err?.data?.error || err.message || 'Stock take failed');
    } finally {
      setBusy(false);
    }
  };

  const hasErrors = (plan?.summary?.error ?? 0) > 0;
  const changes = plan ? plan.summary.increase + plan.summary.decrease : 0;

  const footer = done ? (
    <button
      onClick={handleClose}
      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      Done
    </button>
  ) : (
    <>
      <button
        onClick={handleClose}
        className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Cancel
      </button>
      {!plan ? (
        <button
          onClick={handlePreview}
          disabled={busy || !csv}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {busy ? 'Checking…' : 'Preview changes'}
        </button>
      ) : (
        <button
          onClick={handleApply}
          disabled={busy || hasErrors || changes === 0}
          title={
            hasErrors
              ? 'Fix the errors below first — nothing will be applied while any row is invalid'
              : changes === 0
                ? 'Every counted figure already matches, so there is nothing to adjust'
                : undefined
          }
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          {busy ? 'Applying…' : `Apply ${changes} adjustment${changes === 1 ? '' : 's'}`}
        </button>
      )}
    </>
  );

  return (
    <Modal open={show} onClose={handleClose} title="Import stock take" size="xl" footer={footer}>
      {done ? (
        <div className="bg-green-50 border border-green-200 rounded-md p-4 text-sm text-green-900">
          Stock take applied: <strong>{done.increased}</strong> increased,{' '}
          <strong>{done.decreased}</strong> decreased, <strong>{done.unchanged}</strong> already
          matching. Net change <strong>{done.netUnits}</strong> unit
          {Math.abs(done.netUnits) === 1 ? '' : 's'}. Each adjustment is recorded in the stock
          ledger and the ZRA audit trail.
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor="stock-take-file" className="block text-sm font-medium text-gray-700 mb-1">
              Stock take CSV
            </label>
            <input
              id="stock-take-file"
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border file:border-gray-300 file:text-sm file:font-medium file:bg-white hover:file:bg-gray-50"
            />
            <p className="text-xs text-gray-500 mt-1">
              Required columns: <code>sku</code> and <code>counted</code> — the quantity actually
              counted on the shelf, not a difference. Optional: <code>unitCost</code>,{' '}
              <code>reason</code>. Export first for a ready-made count sheet with the{' '}
              <code>counted</code> column left blank.
            </p>
          </div>

          <div>
            <label htmlFor="stock-take-reason" className="block text-sm font-medium text-gray-700 mb-1">
              Reason
            </label>
            <input
              id="stock-take-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Month-end count, 8 August"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Recorded against every adjustment this file creates. A row with its own{' '}
              <code>reason</code> column overrides this.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">{error}</div>
          )}

          {plan && (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="px-3 py-1 rounded bg-green-100 text-green-800">
                  {plan.summary.increase} increase
                </span>
                <span className="px-3 py-1 rounded bg-amber-100 text-amber-800">
                  {plan.summary.decrease} decrease
                </span>
                <span className="px-3 py-1 rounded bg-gray-100 text-gray-700">
                  {plan.summary.unchanged} unchanged
                </span>
                {plan.summary.error > 0 && (
                  <span className="px-3 py-1 rounded bg-red-100 text-red-800">
                    {plan.summary.error} with errors
                  </span>
                )}
                <span className="px-3 py-1 rounded bg-blue-50 text-blue-800">
                  net {plan.summary.netUnits > 0 ? '+' : ''}
                  {plan.summary.netUnits} units
                </span>
              </div>

              {hasErrors && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-900">
                  Nothing will be applied while any row is invalid — fix them and choose the file
                  again. A part-applied stock take is worse than a rejected one.
                </div>
              )}

              <div className="border border-gray-200 rounded-md max-h-80 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      {['Line', 'Change', 'SKU', 'Product', 'On hand', 'Counted', 'Delta', 'Problem'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {plan.rows.map((row) => (
                      <tr key={row.line} className={row.action === 'error' ? 'bg-red-50' : ''}>
                        <td className="px-3 py-2 text-gray-500">{row.line}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs ${ACTION_STYLES[row.action]}`}>
                            {row.action}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-600">{row.sku || '—'}</td>
                        <td className="px-3 py-2 text-gray-900">{row.productName || '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{row.onHand}</td>
                        <td className="px-3 py-2 text-right text-gray-900">
                          {row.counted == null ? '—' : row.counted}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-medium ${
                            row.delta == null ? 'text-gray-400' : row.delta < 0 ? 'text-red-700' : row.delta > 0 ? 'text-green-700' : 'text-gray-500'
                          }`}
                        >
                          {row.delta == null ? '—' : row.delta > 0 ? `+${row.delta}` : row.delta}
                        </td>
                        <td className="px-3 py-2 text-red-700 text-xs">{row.errors.join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {fileName && !plan && !error && (
            <p className="text-sm text-gray-500">
              {fileName} loaded. Choose <strong>Preview changes</strong> to see what would move —
              nothing is adjusted yet.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
};

export default StockTakeImportModal;
