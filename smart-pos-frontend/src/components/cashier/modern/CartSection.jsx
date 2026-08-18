import React from 'react';
import { ShoppingCart, Trash2, Plus, Minus, Percent, AlertCircle } from 'lucide-react';
import { calculateCartTotals, formatZmw } from '../../../utils/cartTotals';

const CartSection = ({
  cart = [],
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onCheckout,
  discountType = 'percentage',
  discountValue = '',
  onDiscountTypeChange,
  onDiscountValueChange,
  usingMockData = false,
  getAvailableStock,
  // NUMZ discount policy (not a ZRA rule) — whether the current user's role
  // may apply a discount directly or at least request one (which still goes
  // through the existing supervisor-approval-ticket flow at checkout). When
  // neither is true (the default for CASHIER), the control is not rendered
  // at all — backend independently enforces this regardless of the UI.
  discountAllowed = false,
}) => {
  const totals = calculateCartTotals(cart, { discountType, discountValue });

  const handleQuantityChange = (itemId, newQuantity) => {
    if (newQuantity >= 1) {
      onUpdateQuantity(itemId, newQuantity);
    }
  };

  return (
    // h-full only takes effect once the parent pane actually has a definite
    // height (the lg:h-full wrapper in CashierDashboard's quickshop layout)
    // — on mobile, where that wrapper has no set height, this degrades to
    // auto and the cart just stacks normally below the product grid.
    <div className="panel h-full flex flex-col">
      <div className="panel-header flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">
            Cart · {totals.itemCount}
          </h3>
        </div>
        <div className="flex items-center gap-3">
          {usingMockData && (
            <span className="status-pill border-amber-200 bg-amber-50 text-amber-800">
              <AlertCircle className="w-3 h-3" />
              Demo data
            </span>
          )}
          {cart.length > 0 && (
            <button
              type="button"
              onClick={onClearCart}
              className="text-xs text-gray-500 hover:text-red-600 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Only this region scrolls — header above and totals/checkout below
          stay pinned in view regardless of how many lines are in the cart. */}
      <div className="panel-body flex-1 min-h-0 overflow-y-auto scroll-thin">
        {cart.length > 0 ? (
          <div className="space-y-2">
            {cart.map((item) => (
              <div key={item.id} className="border border-surface-border rounded p-3 bg-white">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h4 className="font-medium text-gray-900 text-sm truncate min-w-0">{item.name}</h4>
                  <button
                    type="button"
                    onClick={() => onRemoveItem(item.id)}
                    className="p-1 -m-1 text-gray-400 hover:text-red-500 transition-colors shrink-0"
                    aria-label={`Remove ${item.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                  <span>SKU: {item.sku}</span>
                  <span>{formatZmw(item.price)} each</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                      className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label={`Decrease ${item.name} quantity`}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>

                    <span className="w-8 text-center text-sm font-medium text-gray-900">
                      {item.quantity}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                      disabled={getAvailableStock ? item.quantity >= getAvailableStock(item.id) : false}
                      className="p-1 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label={`Increase ${item.name} quantity`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="font-semibold text-gray-900 text-sm">
                    {formatZmw(item.price * item.quantity)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <ShoppingCart className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Your cart is empty</h3>
            <p className="text-gray-500">Add some products to get started</p>
          </div>
        )}
      </div>

      {cart.length > 0 && (
        <div className="border-t border-surface-border shrink-0">
          {discountAllowed && (
            <div className="px-4 pt-4">
              <div className="flex items-center gap-2 mb-2">
                <Percent className="w-3.5 h-3.5 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Discount</span>
              </div>

              <div className="flex gap-2">
                <select
                  value={discountType}
                  onChange={(e) => onDiscountTypeChange?.(e.target.value)}
                  className="input-sys w-28"
                  aria-label="Discount type"
                >
                  <option value="percentage">%</option>
                  <option value="fixed">Fixed Amount</option>
                </select>

                <input
                  type="number"
                  placeholder={discountType === 'percentage' ? '0' : '0.00'}
                  value={discountValue}
                  onChange={(e) => onDiscountValueChange?.(e.target.value)}
                  className="input-sys flex-1"
                  min="0"
                  step={discountType === 'percentage' ? '1' : '0.01'}
                  aria-label="Discount value"
                />
              </div>
            </div>
          )}

          <div className="px-4 pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Subtotal</span>
              <span className="font-medium text-gray-900">{formatZmw(totals.subtotal)}</span>
            </div>

            {totals.discount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Discount</span>
                <span className="font-medium text-emerald-600">-{formatZmw(totals.discount)}</span>
              </div>
            )}

            <div className="flex justify-between text-sm">
              <span className="text-gray-600">VAT (16%)</span>
              <span className="font-medium text-gray-900">{formatZmw(totals.vat)}</span>
            </div>

            <div className="border-t border-surface-border pt-2 flex justify-between">
              <span className="font-semibold text-gray-900">Total</span>
              <span className="font-semibold text-gray-900">{formatZmw(totals.total)}</span>
            </div>
          </div>

          <div className="p-4 pt-3">
            <button
              type="button"
              onClick={onCheckout}
              className="btn-primary w-full py-3 flex items-center justify-center gap-2 text-sm"
            >
              <ShoppingCart className="w-4 h-4" />
              Checkout · {formatZmw(totals.total)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CartSection;
