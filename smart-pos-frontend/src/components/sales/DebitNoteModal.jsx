import { useMemo, useRef, useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { X, FilePlus, Receipt } from 'lucide-react';
import { fetchReceipt } from '../../api/receiptsApi';
import { routeReceiptPrint } from '../../lib/printReceipt';
import { createDebitNote, DEBIT_NOTE_REASON_CODES } from '../../api/salesApi';
import { ReceiptRenderer } from '@smartpos/receipt-engine/react';
import { useAuth } from '../../contexts/AuthContext';

function initialLines(sale) {
  return (sale.saleItems || []).map((item) => ({
    saleItem: item,
    include: false,
    quantity: 1,
    price: item.price,
  }));
}

// A debit note corrects an already-fiscalized sale upward (e.g. it was
// under-billed) — unlike a refund it is not capped by what was originally
// sold, so there is no "remaining quantity" concept here.
const DebitNoteModal = ({ sale, onClose, onSuccess }) => {
  const { user } = useAuth();
  const [lines, setLines] = useState(() => initialLines(sale));
  const [reasonCode, setReasonCode] = useState('01');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [receiptVm, setReceiptVm] = useState(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptFormat, setReceiptFormat] = useState('thermal');
  // The very first print of a completed debit note is the original, not a
  // reprint — same reasoning as CheckoutModal's hasPrintedRef.
  const hasPrintedRef = useRef(false);

  const adjustmentTotal = useMemo(
    () =>
      lines
        .filter((l) => l.include)
        .reduce((sum, l) => sum + l.quantity * l.price, 0),
    [lines]
  );

  const canSubmit = lines.some((l) => l.include && l.quantity > 0) && !submitting && !result;

  const toggleLine = (saleItemId) => {
    setLines((prev) =>
      prev.map((l) => (l.saleItem.id === saleItemId ? { ...l, include: !l.include } : l))
    );
  };

  const setLineQty = (saleItemId, qty) => {
    setLines((prev) =>
      prev.map((l) =>
        l.saleItem.id === saleItemId ? { ...l, quantity: Math.max(1, parseInt(qty, 10) || 1) } : l
      )
    );
  };

  const setLinePrice = (saleItemId, price) => {
    setLines((prev) =>
      prev.map((l) =>
        l.saleItem.id === saleItemId ? { ...l, price: Math.max(0, parseFloat(price) || 0) } : l
      )
    );
  };

  const handleSubmit = async () => {
    if (!user?.id) {
      setError('You must be logged in to issue a debit note.');
      return;
    }

    const items = lines
      .filter((l) => l.include && l.quantity > 0)
      .map((l) => ({
        saleItemId: l.saleItem.id,
        productId: l.saleItem.productId,
        quantity: l.quantity,
        price: l.price,
      }));

    if (items.length === 0) {
      setError('Select at least one line to adjust.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const data = await createDebitNote(sale.id, {
        userId: user.id,
        reasonCode,
        reason: reason.trim() || DEBIT_NOTE_REASON_CODES.find((r) => r.code === reasonCode)?.label,
        items,
      });
      setResult(data);
      onSuccess?.(data);
      if (data.debitNote?.id) {
        setReceiptLoading(true);
        try {
          const vm = await fetchReceipt('debit-notes', data.debitNote.id);
          setReceiptVm(vm);
        } catch (e) {
          console.error('Failed to load debit note receipt:', e);
        } finally {
          setReceiptLoading(false);
        }
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Debit note failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrintReceipt = async () => {
    const debitNoteId = result?.debitNote?.id;
    if (!debitNoteId) return;
    try {
      const vm = await fetchReceipt('debit-notes', debitNoteId, { reprint: hasPrintedRef.current });
      hasPrintedRef.current = true;
      setReceiptVm(vm);
      if (vm) {
        await routeReceiptPrint(vm);
      } else {
        window.print();
      }
    } catch (e) {
      console.error('Reprint failed:', e);
      window.print();
    }
  };

  const dialogRef = useDialog(true, onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Debit note"
        tabIndex={-1}
        className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col focus:outline-none"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Debit note</h2>
            <p className="text-sm text-gray-500 font-mono">{sale.rcptNo || sale.id}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {result ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-green-800 font-medium">
                  <Receipt className="w-5 h-5" />
                  Debit note issued
                </div>
                <p className="text-sm text-green-900">
                  Receipt: <span className="font-mono">{result.fiscal?.rcptNo}</span>
                </p>
              </div>
              {receiptLoading && <p className="text-sm text-gray-500">Loading debit note receipt…</p>}
              {receiptVm && (
                <div>
                  <div className="flex justify-center gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setReceiptFormat('thermal')}
                      className={`px-2 py-0.5 text-xs rounded border ${
                        receiptFormat === 'thermal'
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'border-gray-300 text-gray-600'
                      }`}
                    >
                      80mm
                    </button>
                    <button
                      type="button"
                      onClick={() => setReceiptFormat('a4')}
                      className={`px-2 py-0.5 text-xs rounded border ${
                        receiptFormat === 'a4'
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'border-gray-300 text-gray-600'
                      }`}
                    >
                      A4
                    </button>
                  </div>
                  <div className="max-h-[50vh] overflow-y-auto border border-gray-200 rounded bg-white">
                    <ReceiptRenderer viewModel={receiptVm} format={receiptFormat} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
                {lines.map(({ saleItem, include, quantity, price }) => (
                  <li key={saleItem.id} className="px-4 py-3 flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={include}
                      onChange={() => toggleLine(saleItem.id)}
                      className="w-4 h-4"
                      aria-label={`Include ${saleItem.product?.name || saleItem.productId}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {saleItem.product?.name || saleItem.productId}
                      </p>
                      <p className="text-xs text-gray-500">Originally sold: {saleItem.quantity} × K{saleItem.price.toFixed(2)}</p>
                    </div>
                    {include && (
                      <div className="flex items-center gap-2">
                        <label className="flex flex-col items-end text-xs text-gray-500">
                          Qty
                          <input
                            type="number"
                            min={1}
                            value={quantity}
                            onChange={(e) => setLineQty(saleItem.id, e.target.value)}
                            className="w-14 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                          />
                        </label>
                        <label className="flex flex-col items-end text-xs text-gray-500">
                          Price
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={price}
                            onChange={(e) => setLinePrice(saleItem.id, e.target.value)}
                            className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                          />
                        </label>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-gray-600 text-right">
                Adjustment subtotal: <span className="font-semibold">K{adjustmentTotal.toFixed(2)}</span>
              </p>

              <div className="grid grid-cols-1 gap-3">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Reason code</span>
                  <select
                    value={reasonCode}
                    onChange={(e) => setReasonCode(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  >
                    {DEBIT_NOTE_REASON_CODES.map((r) => (
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
                    placeholder="Explain the adjustment"
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
          {result && receiptVm && (
            <button
              type="button"
              onClick={handlePrintReceipt}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Print receipt
            </button>
          )}
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
              className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              <FilePlus className="w-4 h-4" />
              {submitting ? 'Processing…' : 'Issue debit note'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DebitNoteModal;
