import { useState, useEffect } from 'react'

const ShoppingCart = ({ 
  cart, 
  total, 
  itemCount, 
  onUpdateItem, 
  onRemoveItem, 
  onCheckout, 
  onClearCart 
}) => {
  const [customerInfo, setCustomerInfo] = useState({
    name: '',
    phone: '',
    email: '',
    loyaltyCard: ''
  })
  const [discount, setDiscount] = useState(0)
  const [loyaltyDiscount, setLoyaltyDiscount] = useState(0)
  const [showCustomerForm, setShowCustomerForm] = useState(false)
  const [notes, setNotes] = useState('')

  // Calculate totals
  const subtotal = total / 1.16 // Remove VAT to get subtotal
  const vatAmount = total - subtotal
  const discountAmount = (subtotal * discount) / 100
  const loyaltyDiscountAmount = (subtotal * loyaltyDiscount) / 100
  const finalTotal = total - discountAmount - loyaltyDiscountAmount

  // Check loyalty card
  useEffect(() => {
    if (customerInfo.loyaltyCard) {
      // Mock loyalty check - replace with API call
      const mockLoyaltyData = {
        'GOLD123': { discount: 10, points: 450 },
        'SILVER456': { discount: 5, points: 200 },
        'BRONZE789': { discount: 2, points: 50 }
      }
      
      const loyaltyData = mockLoyaltyData[customerInfo.loyaltyCard.toUpperCase()]
      if (loyaltyData) {
        setLoyaltyDiscount(loyaltyData.discount)
      } else {
        setLoyaltyDiscount(0)
      }
    } else {
      setLoyaltyDiscount(0)
    }
  }, [customerInfo.loyaltyCard])

  const handleQuantityChange = (productId, newQuantity) => {
    if (newQuantity >= 0) {
      onUpdateItem(productId, parseInt(newQuantity))
    }
  }

  const applyDiscount = (discountPercent) => {
    setDiscount(discountPercent)
  }

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-ZM', {
      style: 'currency',
      currency: 'ZMW',
      minimumFractionDigits: 2
    }).format(amount)
  }

  const QuantityControls = ({ item }) => (
    <div className="flex items-center space-x-1">
      <button
        onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
        className="w-8 h-8 flex items-center justify-center bg-red-100 hover:bg-red-200 text-red-600 rounded-full transition-colors"
        disabled={item.quantity <= 1}
      >
        −
      </button>
      <input
        type="number"
        value={item.quantity}
        onChange={(e) => handleQuantityChange(item.id, parseInt(e.target.value) || 0)}
        className="w-12 text-center border border-gray-300 rounded py-1 text-sm"
        min="1"
      />
      <button
        onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
        className="w-8 h-8 flex items-center justify-center bg-green-100 hover:bg-green-200 text-green-600 rounded-full transition-colors"
      >
        +
      </button>
    </div>
  )

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Cart Header */}
      <div className="p-4 border-b border-gray-200 glass">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            🛒 Cart
            {itemCount > 0 && (
              <span className="ml-2 bg-blue-600 text-white text-xs px-2 py-1 rounded-full">
                {itemCount}
              </span>
            )}
          </h2>
          {cart.length > 0 && (
            <button
              onClick={onClearCart}
              className="text-sm text-red-600 hover:text-red-800 transition-colors"
              title="Clear entire cart (Ctrl+Delete)"
            >
              🗑️ Clear
            </button>
          )}
        </div>
      </div>

      {/* Customer Info Toggle */}
      <div className="p-4 border-b border-gray-200">
        <button
          onClick={() => setShowCustomerForm(!showCustomerForm)}
          className="flex justify-between items-center w-full text-left"
        >
          <span className="text-sm font-medium text-gray-700 flex items-center">
            👤 Customer Info
            {(customerInfo.name || customerInfo.phone) && (
              <span className="ml-2 w-2 h-2 bg-green-500 rounded-full"></span>
            )}
          </span>
          <span className={`transform transition-transform ${showCustomerForm ? 'rotate-180' : ''}`}>
            ⌄
          </span>
        </button>
        
        {showCustomerForm && (
          <div className="mt-3 space-y-2 animate-slide-in-left">
            <input
              type="text"
              placeholder="Customer name (optional)"
              value={customerInfo.name}
              onChange={(e) => setCustomerInfo(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="tel"
              placeholder="Phone number"
              value={customerInfo.phone}
              onChange={(e) => setCustomerInfo(prev => ({ ...prev, phone: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="email"
              placeholder="Email (for receipt)"
              value={customerInfo.email}
              onChange={(e) => setCustomerInfo(prev => ({ ...prev, email: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <div className="relative">
              <input
                type="text"
                placeholder="Loyalty card number"
                value={customerInfo.loyaltyCard}
                onChange={(e) => setCustomerInfo(prev => ({ ...prev, loyaltyCard: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {loyaltyDiscount > 0 && (
                <div className="absolute right-2 top-1/2 transform -translate-y-1/2 text-green-600 text-xs">
                  {loyaltyDiscount}% OFF
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Cart Items */}
      <div className="flex-1 overflow-y-auto">
        {cart.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="text-4xl mb-4">🛒</div>
            <p className="font-medium">Your cart is empty</p>
            <p className="text-sm">Add some products to get started</p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {cart.map(item => (
              <div key={item.id} className="bg-gray-50 rounded-lg p-3 hover:bg-gray-100 transition-colors group">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900 text-sm">
                      {item.name}
                    </h4>
                    <p className="text-xs text-gray-500">
                      {formatCurrency(item.price)} each
                    </p>
                  </div>
                  <button
                    onClick={() => onRemoveItem(item.id)}
                    className="text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity ml-2"
                    title="Remove item"
                  >
                    🗑️
                  </button>
                </div>
                
                <div className="flex justify-between items-center">
                  <QuantityControls item={item} />
                  
                  <div className="text-right">
                    <p className="font-semibold text-green-600">
                      {formatCurrency(item.price * item.quantity)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Discount Section */}
      {cart.length > 0 && (
        <div className="p-4 border-t border-gray-200">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-700">Quick Discounts:</span>
          </div>
          <div className="flex space-x-2">
            {[5, 10, 15, 20].map(percent => (
              <button
                key={percent}
                onClick={() => applyDiscount(percent)}
                className={`px-2 py-1 text-xs rounded ${
                  discount === percent 
                    ? 'bg-red-600 text-white' 
                    : 'bg-gray-200 hover:bg-gray-300'
                }`}
              >
                {percent}%
              </button>
            ))}
            <button
              onClick={() => applyDiscount(0)}
              className="px-2 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Order Notes */}
      {cart.length > 0 && (
        <div className="p-4 border-t border-gray-200">
          <textarea
            placeholder="Order notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows="2"
          />
        </div>
      )}

      {/* Cart Summary & Checkout */}
      {cart.length > 0 && (
        <div className="border-t border-gray-200 p-4 space-y-4 bg-gray-50">
          {/* Totals */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Subtotal:</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            
            {discount > 0 && (
              <div className="flex justify-between text-sm text-red-600">
                <span>Discount ({discount}%):</span>
                <span>-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            
            {loyaltyDiscount > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Loyalty Discount ({loyaltyDiscount}%):</span>
                <span>-{formatCurrency(loyaltyDiscountAmount)}</span>
              </div>
            )}
            
            <div className="flex justify-between text-sm">
              <span>VAT (16%):</span>
              <span>{formatCurrency(vatAmount)}</span>
            </div>
            
            <div className="flex justify-between text-lg font-bold border-t pt-2">
              <span>Total:</span>
              <span className="text-green-600">{formatCurrency(finalTotal)}</span>
            </div>
          </div>

          {/* Checkout Button */}
          <button
            onClick={onCheckout}
            className="w-full btn-success py-3 text-lg font-semibold transform hover:scale-105 transition-all duration-200"
            title="Proceed to checkout (Ctrl+Enter)"
          >
            💳 Checkout - {formatCurrency(finalTotal)}
          </button>
          
          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => window.print()}
              className="btn-secondary text-sm py-2"
            >
              🖨️ Print Quote
            </button>
            <button
              onClick={() => {
                // Save cart for later
                localStorage.setItem('savedCart', JSON.stringify(cart))
              }}
              className="btn-secondary text-sm py-2"
            >
              💾 Save for Later
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ShoppingCart
