import React, { useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import { productApi } from '../../services/productService';

const isCoded = (p) => Boolean(p.zraClassificationCode || p.zraItemClassification);
const isEligible = (p) => p.zraRegistrationStatus !== 'REGISTERED' && isCoded(p);
const isNoCode = (p) => p.zraRegistrationStatus !== 'REGISTERED' && !isCoded(p);

/**
 * Best-effort registration for existing products already stuck at
 * PENDING/FAILED — the counterpart to CSV import's automatic registration
 * pass, for products backfilled with a code via re-import or a manual edit.
 * No preview phase: unlike CSV import, this acts on already-committed DB
 * state, so there's nothing to preview — only an eligible-count summary
 * computed from the already-loaded product list.
 */
const BulkRegisterModal = ({ show, onClose, products, onDone }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const eligibleCount = useMemo(() => products.filter(isEligible).length, [products]);
  const noCodeCount = useMemo(() => products.filter(isNoCode).length, [products]);

  const reset = () => {
    setBusy(false);
    setError('');
    setResult(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleRegister = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await productApi.bulkRegister();
      setResult(res);
      onDone?.();
    } catch (err) {
      setError(err?.data?.error || err.message || 'Bulk registration failed');
    } finally {
      setBusy(false);
    }
  };

  const footer = result ? (
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
      <button
        onClick={handleRegister}
        disabled={busy || eligibleCount === 0}
        title={eligibleCount === 0 ? 'No products with a classification code are waiting to register' : undefined}
        className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-500"
      >
        {busy ? 'Registering…' : `Register ${eligibleCount} product${eligibleCount === 1 ? '' : 's'}`}
      </button>
    </>
  );

  return (
    <Modal open={show} onClose={handleClose} title="Register pending products with ZRA" size="lg" footer={footer}>
      {result ? (
        <div className="space-y-3">
          <div className="bg-green-50 border border-green-200 rounded-md p-4 text-sm text-green-900">
            Registered <strong>{result.registered}</strong> of <strong>{result.attempted}</strong> attempted.
            {result.failed > 0 && (
              <> <strong>{result.failed}</strong> failed — see below.</>
            )}
            {result.remaining > 0 && (
              <> <strong>{result.remaining}</strong> more are ready and waiting — run this again to continue.</>
            )}
          </div>

          {result.failed > 0 && (
            <div className="border border-gray-200 rounded-md max-h-56 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {['SKU', 'Name', 'Error'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.results
                    .filter((r) => r.status === 'FAILED')
                    .map((r) => (
                      <tr key={r.productId} className="bg-red-50">
                        <td className="px-3 py-2 text-gray-600">{r.sku || '—'}</td>
                        <td className="px-3 py-2 text-gray-900">{r.name || '—'}</td>
                        <td className="px-3 py-2 text-red-700 text-xs">{r.error || ''}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {result.skippedNoCode > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-900">
              <strong>{result.skippedNoCode}</strong> product{result.skippedNoCode === 1 ? '' : 's'} still{' '}
              {result.skippedNoCode === 1 ? "has" : 'have'} no classification code, so{' '}
              {result.skippedNoCode === 1 ? "wasn't" : "weren't"} attempted:
              <ul className="mt-1 list-disc list-inside">
                {result.noCodeProducts.map((p) => (
                  <li key={p.id}>
                    {p.name} {p.sku ? `(${p.sku})` : ''}
                  </li>
                ))}
              </ul>
              Add a classification code from the product list, or re-import via CSV with the code filled in.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            <strong>{eligibleCount}</strong> product{eligibleCount === 1 ? '' : 's'} {eligibleCount === 1 ? 'is' : 'are'} not
            yet registered with ZRA but already {eligibleCount === 1 ? 'has' : 'have'} a classification code — this will
            attempt registration for {eligibleCount === 1 ? 'it' : 'all of them'} now.
          </p>
          {noCodeCount > 0 && (
            <p className="text-sm text-gray-500">
              <strong>{noCodeCount}</strong> other product{noCodeCount === 1 ? '' : 's'} {noCodeCount === 1 ? 'has' : 'have'}{' '}
              no classification code at all and can't be registered yet — export the catalog, fill in codes, and
              re-import, or add one from the product list.
            </p>
          )}
          {eligibleCount > 200 && (
            <p className="text-xs text-gray-500">
              Only the first 200 will be attempted this run (oldest-stuck-first) — run again afterward to work
              through the rest.
            </p>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">{error}</div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default BulkRegisterModal;
