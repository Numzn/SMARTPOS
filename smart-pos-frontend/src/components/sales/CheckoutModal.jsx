import React, { useState } from 'react';
import { useSales } from '../../contexts/SalesContext';

const CheckoutModal = ({ onClose }) => {
  const { cart, getCartTotal, processCheckout, paymentMethod, setPaymentMethod } = useSales();
  const { subtotal, discountAmount, taxAmount, total } = getCartTotal();
  const [isProcessing, setIsProcessing] = useState(false);
  const [customerInfo, setCustomerInfo] = useState({
    name: '',
    phone: '',
    email: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsProcessing(true);

    try {
      const result = await processCheckout({
        customer: customerInfo,
        paymentMethod
      });

      if (result.success) {
        alert('Sale completed successfully!');
        onClose();
      } else {
        alert('Checkout failed: ' + result.error);
      }
    } catch (error) {
      alert('Checkout failed: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md bg-white">
        <div className="mt-3">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b">
            <h3 className="text-lg font-medium text-gray-900">Complete Sale</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="mt-6 space-y-6">
              {/* Order Summary */}
              <div>
                <h4 className="text-md font-medium text-gray-900 mb-4">Order Summary</h4>
                <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                  {cart.map((item) => (
                    <div key={item.productId} className="flex justify-between text-sm">
                      <span>{item.product.name} x {item.quantity}</span>
                      <span>K{(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="border-t pt-2 space-y-1">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span>K{subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tax (16%)</span>
                      <span>K{taxAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-lg border-t pt-2">
                      <span>Total</span>
                      <span>K{total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Customer Information */}
              <div>
                <h4 className="text-md font-medium text-gray-900 mb-4">Customer Information (Optional)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    type="text"
                    placeholder="Customer Name"
                    value={customerInfo.name}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, name: e.target.value })}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <input
                    type="tel"
                    placeholder="Phone Number"
                    value={customerInfo.phone}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Payment Method */}
              <div>
                <h4 className="text-md font-medium text-gray-900 mb-4">Payment Method</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { value: 'CASH', label: '💵 Cash', icon: '💵' },
                    { value: 'CARD', label: '💳 Card', icon: '💳' },
                    { value: 'DIGITAL_WALLET', label: '📱 Digital', icon: '📱' },
                    { value: 'BANK_TRANSFER', label: '🏦 Transfer', icon: '🏦' }
                  ].map((method) => (
                    <button
                      key={method.value}
                      type="button"
                      onClick={() => setPaymentMethod(method.value)}
                      className={`p-3 border rounded-lg text-center transition-colors ${
                        paymentMethod === method.value
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      <div className="text-2xl mb-1">{method.icon}</div>
                      <div className="text-xs">{method.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex space-x-4 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 bg-gray-300 text-gray-700 py-3 px-4 rounded-md hover:bg-gray-400 transition duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProcessing || cart.length === 0}
                  className="flex-1 bg-indigo-600 text-white py-3 px-4 rounded-md hover:bg-indigo-700 transition duration-150 disabled:opacity-50"
                >
                  {isProcessing ? (
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Processing...
                    </div>
                  ) : (
                    `Complete Sale - K${total.toFixed(2)}`
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CheckoutModal;
