import { useEffect, useMemo, useState } from 'react';
import { X, RotateCcw, Receipt } from 'lucide-react';
import { fetchSaleRefunds, refundSale, REFUND_REASON_CODES } from '../../api/salesApi';
import { useAuth } from '../../contexts/AuthContext';

function computeRemaining(sale, priorRefunds) {
  const refunded = new Map();
  for (const refund of priorRefunds || []) {
    if (refund.status !== 'COMPLETED') continue;
    for (const line of refund.refundItems || []) {
      if (!line.saleItemId) continue;
      refunded.set(line.saleItemId, (refunded.get(line.saleItemId) || 0) + line.quantity);
    }
  }

  return (sale.saleItems || []).map((item) => {
    const already = refunded.get(item.id) || 0;
    const remaining = Math.max(0, item.quantity - already);
    return { saleItem: item, remaining, refundQty: remaining };
  });
}

const RefundModal = ({ sale, onClose, onSuccess }) => {
  const { user } = useAuth();
  const [lines, setLines] = useState([]);
  const [reasonCode, setReasonCode] = useState('01');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const prior = await fetchSaleRefunds(sale.id);
        if (!cancelled) {
          setLines(computeRemaining(sale, prior));
        }
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.error || e.message || 'Failed to load refund data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sale]);

  const refundableTotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.refundQty * l.saleItem.price, 0),
    [lines]
  );

  const canSubmit = lines.some((l) => l.remaining > 0 && l.refundQty > 0) && !submitting && !result;

  const setLineQty = (saleItemId, qty) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.saleItem.id !== saleItemId) return l;
        const n = Math.min(l.remaining, Math.max(0, parseInt(qty, 10) || 0));
        return { ...l, refundQty: n };
      })
    );
  };

  const handleFullRefund = () => {
    setLines((prev) => prev.map((l) => ({ ...l, refundQty: l.remaining })));
  };

  const handleSubmit = async () => {
    if (!user?.id) {
      setError('You must be logged in to process a refund.');
      return;
    }

    const items = lines
      .filter((l) => l.refundQty > 0)
      .map((l) => ({ saleItemId: l.saleItem.id, quantity: l.refundQty }));

    if (items.length === 0) {
      setError('Select at least one item to refund.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const data = await refundSale(sale.id, {
        userId: user.id,
        reasonCode,
        reason: reason.trim() || REFUND_REASON_CODES.find((r) => r.code === reasonCode)?.label,
        items,
      });
      setResult(data);
      onSuccess?.(data);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Refund failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Credit note / refund</h2>
            <p className="text-sm text-gray-500 font-mono">{sale.rcptNo || sale.id}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {result ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-green-800 font-medium">
                <Receipt className="w-5 h-5" />
                Credit note issued
              </div>
              <p className="text-sm text-green-900">
                Receipt: <span className="font-mono">{result.fiscal?.rcptNo}</span>
              </p>
              {result.fiscal?.qrCode && (
                <p className="text-xs text-green-700 break-all">{result.fiscal.qrCode}</p>
              )}
              <p className="text-sm text-green-800">Stock has been restored for returned items.</p>
            </div>
          ) : loading ? (
            <p className="text-sm text-gray-500">Loading sale lines…</p>
          ) : (
            <>
              {lines.length === 0 || lines.every((l) => l.remaining === 0) ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
                  This sale has no remaining quantity to refund.
                </p>
              ) : (
                <>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleFullRefund}
                      className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Refund all remaining
                    </button>
                  </div>
                  <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
                    {lines.map(({ saleItem, remaining, refundQty }) => (
                      <li key={saleItem.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {saleItem.product?.name || saleItem.productId}
                          </p>
                          <p className="text-xs text-gray-500">
                            Sold: {saleItem.quantity} · Remaining: {remaining} · K
                            {saleItem.price.toFixed(2)}
                          </p>
                        </div>
                        {remaining > 0 ? (
                          <input
                            type="number"
                            min={0}
                            max={remaining}
                            value={refundQty}
                            onChange={(e) => setLineQty(saleItem.id, e.target.value)}
                            className="w-16 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                          />
                        ) : (
                          <span className="text-xs text-gray-400">Refunded</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm text-gray-600 text-right">
                    Refund subtotal: <span className="font-semibold">K{refundableTotal.toFixed(2)}</span>
                  </p>
                </>
              )}

              <div className="grid grid-cols-1 gap-3">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Reason code</span>
                  <select
                    value={reasonCode}
                    onChange={(e) => setReasonCode(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  >
                    {REFUND_REASON_CODES.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.code} — {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Notes (optional)</span>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Additional refund notes"
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </>
          )}

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Processing…' : 'Issue credit note'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default RefundModal;
