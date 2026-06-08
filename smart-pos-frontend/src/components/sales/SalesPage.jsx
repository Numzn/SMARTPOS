import React, { useState } from 'react';
import ProductSearch from './ProductSearch';
import ShoppingCart from './ShoppingCart';
import CheckoutModal from './CheckoutModal';

const SalesPage = () => {
  const [showCheckout, setShowCheckout] = useState(false);

  const handleCheckout = () => {
    setShowCheckout(true);
  };

  const handleCheckoutClose = () => {
    setShowCheckout(false);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h1 className="text-2xl font-bold text-gray-900">Point of Sale</h1>
        <p className="text-gray-600 mt-1">Search products and process sales</p>
      </div>

      {/* Main Sales Interface */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Product Search - Takes up 2 columns on large screens */}
        <div className="lg:col-span-2">
          <ProductSearch />
        </div>

        {/* Shopping Cart - Takes up 1 column */}
        <div className="lg:col-span-1">
          <ShoppingCart onCheckout={handleCheckout} />
        </div>
      </div>

      {/* Checkout Modal */}
      {showCheckout && (
        <CheckoutModal onClose={handleCheckoutClose} />
      )}
    </div>
  );
};

export default SalesPage;
