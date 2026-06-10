import React from 'react';
import { Wifi, Printer, ShoppingCart } from 'lucide-react';
import { formatZmw } from '../../../utils/cartTotals';

const StatusBar = ({
  zraStatus = 'unknown',
  printerStatus = 'ready',
  networkStatus = 'connected',
  cartSummary = { itemCount: 0, total: 0 },
  onCheckout,
}) => {
  const zraOk = zraStatus === 'connected' || zraStatus === 'ready';

  const pill = (label, value, ok) => (
    <div
      className={`status-pill ${
        ok ? 'border-gray-200 bg-gray-50 text-gray-700' : 'border-red-200 bg-red-50 text-red-700'
      }`}
    >
      <span className={`status-dot ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {label}: {value}
    </div>
  );

  return (
    <footer className="h-11 flex-shrink-0 bg-surface-raised border-t border-surface-border px-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        {pill('ZRA', zraStatus, zraOk)}
        {pill('Printer', printerStatus, printerStatus === 'ready')}
        <div className="status-pill border-gray-200 bg-gray-50 text-gray-700">
          <Wifi className="w-3 h-3" />
          Net: {networkStatus}
        </div>
      </div>

      <div className="flex items-center gap-4 font-mono text-sm">
        <div className="flex items-center gap-2 text-gray-600">
          <ShoppingCart className="w-3.5 h-3.5" />
          <span>
            {cartSummary.itemCount} item{cartSummary.itemCount !== 1 ? 's' : ''}
          </span>
        </div>
        <span className="font-semibold text-gray-900">{formatZmw(cartSummary.total)}</span>
        <button
          type="button"
          onClick={onCheckout}
          disabled={cartSummary.itemCount === 0}
          className="btn-primary px-5"
        >
          Checkout
        </button>
      </div>
    </footer>
  );
};

export default StatusBar;
