import React from 'react';
import { ShoppingCart } from 'lucide-react';
import { formatZmw } from '../../../utils/cartTotals';

// Device/system status (ZRA, printer, network) moved to CashierTopBar as
// icon-only indicators — this bar is transaction controls only now: the
// running cart total and the checkout action, always in view at the
// bottom of the workspace regardless of what's scrolled in the middle.
const StatusBar = ({ cartSummary = { itemCount: 0, total: 0 }, onCheckout }) => {
  return (
    <footer className="h-11 flex-shrink-0 bg-surface-raised border-t border-surface-border px-4 flex items-center justify-end gap-4">
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
