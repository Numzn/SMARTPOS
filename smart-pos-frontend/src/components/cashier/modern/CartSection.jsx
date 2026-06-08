import React, { useState } from 'react';
import { ShoppingCart, Trash2, Plus, Minus, Percent, AlertCircle } from 'lucide-react';

const CartSection = ({ 
  cart = [], 
  onUpdateQuantity, 
  onRemoveItem, 
  onClearCart, 
  onCheckout,
  usingMockData = false 
}) => {
  const [discountType, setDiscountType] = useState('percentage'); // 'percentage' or 'fixed'
  const [discountValue, setDiscountValue] = useState('');

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-ZM', {
      style: 'currency',
      currency: 'ZMW',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const calculateSubtotal = () => {
    return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  };

  const calculateDiscount = () => {
    if (!discountValue || parseFloat(discountValue) <= 0) return 0;
    
    const subtotal = calculateSubtotal();
    if (discountType === 'percentage') {
      const percentage = Math.min(parseFloat(discountValue), 100);
      return (subtotal * percentage) / 100;
    } else {
      return Math.min(parseFloat(discountValue), subtotal);
    }
  };

  const calculateTax = () => {
    const subtotal = calculateSubtotal();
    const discount = calculateDiscount();
    const taxableAmount = subtotal - discount;
    return taxableAmount * 0.16; // 16% VAT
  };

  const calculateTotal = () => {
    const subtotal = calculateSubtotal();
    const discount = calculateDiscount();
    const tax = calculateTax();
    return subtotal - discount + tax;
  };

  const handleQuantityChange = (itemId, newQuantity) => {
    if (newQuantity >= 1) {
      onUpdateQuantity(itemId, newQuantity);
    }
  };

  const getItemTotal = (item) => {
    return item.price * item.quantity;
  };

  return (
    <div className="bg-white rounded-xl border shadow-sm p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
          <div className="p-2 bg-green-50 rounded-lg">
            <ShoppingCart className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Shopping Cart</h3>
            <p className="text-sm text-gray-500">
              {cart.length} item{cart.length !== 1 ? 's' : ''} in cart
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

      {/* Cart Items */}
      {cart.length > 0 ? (
        <div className="space-y-4 mb-6">
          {cart.map((item) => (
            <div key={item.id} className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
              {/* Product Info */}
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-gray-900">{item.name}</h4>
                  <button
                    onClick={() => onRemoveItem(item.id)}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>SKU: {item.sku}</span>
                  <span>{formatCurrency(item.price)} each</span>
                </div>
              </div>

              {/* Quantity Controls */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                
                <span className="w-12 text-center font-medium text-gray-900">
                  {item.quantity}
                </span>
                
                <button
                  onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Item Total */}
              <div className="text-right">
                <div className="font-semibold text-gray-900">
                  {formatCurrency(getItemTotal(item))}
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

      {/* Discount Section */}
      {cart.length > 0 && (
        <div className="border-t border-gray-200 pt-4 mb-6">
          <div className="flex items-center space-x-2 mb-3">
            <Percent className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Discount</span>
          </div>
          
          <div className="flex space-x-2">
            <select
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="percentage">%</option>
              <option value="fixed">Fixed Amount</option>
            </select>
            
            <input
              type="number"
              placeholder={discountType === 'percentage' ? '0' : '0.00'}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min="0"
              step={discountType === 'percentage' ? '1' : '0.01'}
            />
          </div>
        </div>
      )}

      {/* Totals */}
      {cart.length > 0 && (
        <div className="border-t border-gray-200 pt-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Subtotal</span>
            <span className="font-medium">{formatCurrency(calculateSubtotal())}</span>
          </div>
          
          {calculateDiscount() > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Discount</span>
              <span className="font-medium text-green-600">-{formatCurrency(calculateDiscount())}</span>
            </div>
          )}
          
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">VAT (16%)</span>
            <span className="font-medium">{formatCurrency(calculateTax())}</span>
          </div>
          
          <div className="border-t border-gray-200 pt-3">
            <div className="flex justify-between text-lg font-semibold">
              <span className="text-gray-900">Total</span>
              <span className="text-gray-900">{formatCurrency(calculateTotal())}</span>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      {cart.length > 0 && (
        <div className="flex space-x-3 mt-6">
          <button
            onClick={onClearCart}
            className="flex-1 py-3 px-4 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Clear Cart
          </button>
          
          <button
            onClick={onCheckout}
            className="flex-1 py-3 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Checkout
          </button>
        </div>
      )}
    </div>
  );
};

export default CartSection;


