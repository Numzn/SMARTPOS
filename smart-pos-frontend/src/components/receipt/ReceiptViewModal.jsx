import { useEffect, useState } from 'react';
import { X, Printer } from 'lucide-react';
import { fetchReceipt } from '../../api/receiptsApi';
import { routeReceiptPrint } from '../../lib/printReceipt';
import { ReceiptRenderer } from '@smartpos/receipt-engine/react';

export default function ReceiptViewModal({
  sourceType,
  sourceId,
  title = 'Receipt',
  onClose,
}) {
  const [format, setFormat] = useState('thermal');
  const [vm, setVm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchReceipt(sourceType, sourceId);
        if (!cancelled) setVm(data);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load receipt');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceType, sourceId]);

  const handlePrint = async () => {
    try {
      const data = await fetchReceipt(sourceType, sourceId, { reprint: true });
      setVm(data);
      if (data) {
        await routeReceiptPrint(data);
      } else {
        window.print();
      }
    } catch {
      window.print();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFormat('thermal')}
              className={`px-2 py-1 text-xs rounded border ${
                format === 'thermal'
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'border-gray-300 text-gray-700'
              }`}
            >
              Thermal
            </button>
            <button
              type="button"
              onClick={() => setFormat('a4')}
              className={`px-2 py-1 text-xs rounded border ${
                format === 'a4'
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'border-gray-300 text-gray-700'
              }`}
            >
              A4
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={!vm}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Printer className="w-3 h-3" /> Print
            </button>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 bg-gray-50">
          {loading && <p className="text-sm text-gray-500 text-center">Loading receipt…</p>}
          {error && (
            <p className="text-sm text-red-600 text-center bg-red-50 border border-red-200 rounded p-3">
              {error}
            </p>
          )}
          {vm && <ReceiptRenderer viewModel={vm} format={format} />}
        </div>
      </div>
    </div>
  );
}
