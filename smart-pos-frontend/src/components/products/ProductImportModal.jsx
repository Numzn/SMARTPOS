import React, { useState, useRef } from 'react';
import Modal from '../ui/Modal';
import { productImportApi } from '../../services/productImportService';

const ACTION_STYLES = {
  create: 'bg-green-100 text-green-700',
  update: 'bg-blue-100 text-blue-700',
  error: 'bg-red-100 text-red-700',
};

/**
 * Two-step import: preview, then apply. An import can rewrite the catalogue a
 * till is actively selling from, so nothing is written until the user has seen
 * exactly what would change and pressed a second, explicit button.
 */
const ProductImportModal = ({ show, onClose, onImported }) => {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [createCategories, setCreateCategories] = useState(false);
  const fileRef = useRef(null);

  const reset = () => {
    setCsv('');
    setFileName('');
    setPlan(null);
    setError('');
    setDone(null);
    setBusy(false);
    setCreateCategories(false);
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
    // Read locally and send as text — no upload endpoint or multipart handling
    // needed for a catalogue-sized file.
    setCsv(await file.text());
  };

  const handlePreview = async () => {
    setBusy(true);
    setError('');
    try {
      setPlan(await productImportApi.preview(csv, createCategories));
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
      const result = await productImportApi.commit(csv, createCategories);
      setDone(result);
      onImported?.();
    } catch (err) {
      setError(err?.data?.error || err.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const hasErrors = (plan?.summary?.error ?? 0) > 0;

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
          disabled={busy || hasErrors}
          title={hasErrors ? 'Fix the errors below first — nothing will be imported while any row is invalid' : undefined}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          {busy ? 'Importing…' : `Import ${plan.summary.create + plan.summary.update} row(s)`}
        </button>
      )}
    </>
  );

  return (
    <Modal
      open={show}
      onClose={handleClose}
      title="Import products from CSV"
      size="xl"
      footer={footer}
    >
      {done ? (
        <div className="bg-green-50 border border-green-200 rounded-md p-4 text-sm text-green-900">
          Imported <strong>{done.created}</strong> new product{done.created === 1 ? '' : 's'} and
          updated <strong>{done.updated}</strong>.
          {done.categoriesCreated > 0 && (
            <> Created <strong>{done.categoriesCreated}</strong> new categor{done.categoriesCreated === 1 ? 'y' : 'ies'}.</>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor="product-import-file" className="block text-sm font-medium text-gray-700 mb-1">
              CSV file
            </label>
            <input
              id="product-import-file"
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border file:border-gray-300 file:text-sm file:font-medium file:bg-white hover:file:bg-gray-50"
            />
            <p className="text-xs text-gray-500 mt-1">
              Required columns: <code>name</code>, <code>price</code>. Optional:{' '}
              <code>sku</code>, <code>category</code>, <code>cost</code>, <code>barcode</code>,{' '}
              <code>brand</code>, <code>unit</code>, <code>taxRate</code>, <code>description</code>.{' '}
              <code>taxRate</code> is a percentage (<code>16</code> = 16% VAT) and also accepts a
              VAT category name — <code>STANDARD</code>, <code>ZERO_RATED</code> or{' '}
              <code>EXEMPT</code>.
              Rows are matched on <code>sku</code> — a match updates, anything else is created.
              Columns you leave out are left untouched. Export the catalogue first for a
              ready-made template.
            </p>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={createCategories}
              onChange={(e) => {
                setCreateCategories(e.target.checked);
                // The preview must always reflect what Import would actually
                // do, so changing this invalidates the current plan.
                setPlan(null);
              }}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Create missing categories</span>
              <span className="block text-xs text-gray-500">
                Off by default — an unrecognised category is usually a typo, and inventing one
                silently is how a catalogue turns to mush.
              </span>
            </span>
          </label>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">{error}</div>
          )}

          {plan && (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="px-3 py-1 rounded bg-green-100 text-green-800">
                  {plan.summary.create} to create
                </span>
                <span className="px-3 py-1 rounded bg-blue-100 text-blue-800">
                  {plan.summary.update} to update
                </span>
                {plan.summary.error > 0 && (
                  <span className="px-3 py-1 rounded bg-red-100 text-red-800">
                    {plan.summary.error} with errors
                  </span>
                )}
              </div>

              {hasErrors && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-900">
                  Nothing will be imported while any row is invalid — fix the rows below and
                  choose the file again. This keeps the catalogue from ending up half-updated.
                </div>
              )}

              <div className="border border-gray-200 rounded-md max-h-80 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      {['Line', 'Action', 'Name', 'SKU', 'Price', 'Problem'].map((h) => (
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
                        <td className="px-3 py-2 text-gray-900">{row.data.name || '—'}</td>
                        <td className="px-3 py-2 text-gray-600">{row.data.sku || '—'}</td>
                        <td className="px-3 py-2 text-gray-600">
                          {row.data.price == null || Number.isNaN(row.data.price)
                            ? '—'
                            : `K${Number(row.data.price).toFixed(2)}`}
                        </td>
                        <td className="px-3 py-2 text-red-700 text-xs">{row.errors.join('; ') || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {fileName && !plan && !error && (
            <p className="text-sm text-gray-500">
              {fileName} loaded. Choose <strong>Preview changes</strong> to see what would happen —
              nothing is written yet.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
};

export default ProductImportModal;
