import React from 'react';
import { ShoppingCart, Trash2, Plus, Minus, Percent, AlertCircle } from 'lucide-react';
import { calculateCartTotals, formatZmw } from '../../../utils/cartTotals';

const CartSection = ({
  cart = [],
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  discountType = 'percentage',
  discountValue = '',
  onDiscountTypeChange,
  onDiscountValueChange,
  usingMockData = false,
  getAvailableStock,
}) => {
  const totals = calculateCartTotals(cart, { discountType, discountValue });

  const handleQuantityChange = (itemId, newQuantity) => {
    if (newQuantity >= 1) {
      onUpdateQuantity(itemId, newQuantity);
    }
  };

  return (
    <div className="bg-white rounded-xl border shadow-sm p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
          <div className="p-2 bg-green-50 rounded-lg">
            <ShoppingCart className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Shopping Cart</h3>
            <p className="text-sm text-gray-500">
              {totals.itemCount} item{totals.itemCount !== 1 ? 's' : ''} in cart
            </p>
          </div>
        </div>

        {usingMockData && (
          <div className="flex items-center space-x-2 px-3 py-1 bg-yellow-50 border border-yellow-200 rounded-full">
            <AlertCircle className="w-4 h-4 text-yellow-600" />
            <span className="text-xs font-medium text-yellow-700">Demo</span>
          </div>
        )}
      </div>

      {cart.length > 0 ? (
        <div className="space-y-4 mb-6">
          {cart.map((item) => (
            <div key={item.id} className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-gray-900">{item.name}</h4>
                  <button
                    type="button"
                    onClick={() => onRemoveItem(item.id)}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    aria-label={`Remove ${item.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>SKU: {item.sku}</span>
                  <span>{formatZmw(item.price)} each</span>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label={`Decrease ${item.name} quantity`}
                >
                  <Minus className="w-4 h-4" />
                </button>

                <span className="w-12 text-center font-medium text-gray-900">
                  {item.quantity}
                </span>

                <button
                  type="button"
                  onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                  disabled={getAvailableStock ? item.quantity >= getAvailableStock(item.id) : false}
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label={`Increase ${item.name} quantity`}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div className="text-right">
                <div className="font-semibold text-gray-900">
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

      {cart.length > 0 && (
        <div className="border-t border-gray-200 pt-4 mb-6">
          <div className="flex items-center space-x-2 mb-3">
            <Percent className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Discount</span>
          </div>

          <div className="flex space-x-2">
            <select
              value={discountType}
              onChange={(e) => onDiscountTypeChange?.(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min="0"
              step={discountType === 'percentage' ? '1' : '0.01'}
              aria-label="Discount value"
            />
          </div>
        </div>
      )}

      {cart.length > 0 && (
        <div className="border-t border-gray-200 pt-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Subtotal</span>
            <span className="font-medium">{formatZmw(totals.subtotal)}</span>
          </div>

          {totals.discount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Discount</span>
              <span className="font-medium text-green-600">-{formatZmw(totals.discount)}</span>
            </div>
          )}

          <div className="flex justify-between text-sm">
            <span className="text-gray-600">VAT (16%)</span>
            <span className="font-medium">{formatZmw(totals.vat)}</span>
          </div>

          <div className="border-t border-gray-200 pt-3">
            <div className="flex justify-between text-lg font-semibold">
              <span className="text-gray-900">Total</span>
              <span className="text-gray-900">{formatZmw(totals.total)}</span>
            </div>
          </div>
        </div>
      )}

      {cart.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={onClearCart}
            className="w-full py-3 px-4 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Clear Cart
          </button>
        </div>
      )}
    </div>
  );
};

export default CartSection;
