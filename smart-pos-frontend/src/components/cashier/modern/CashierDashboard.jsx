import React, { useState, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import CashierHeader from './CashierHeader';
import CashierTabs from './CashierTabs';
import ProductGrid from './ProductGrid';
import CartSection from './CartSection';
import StatusBar from './StatusBar';
import CheckoutModal from '../../CheckoutModal';
import { fetchProducts, fetchCategories, mockProducts, mockCategories } from '../../../api/cashierApi';

const CashierDashboard = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('quickshop');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showCheckout, setShowCheckout] = useState(false);
  const [usingMockData, setUsingMockData] = useState(false);
  
  // Data states
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cart, setCart] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // System status
  const [systemStatus] = useState({
    zra: 'connected',
    printer: 'ready',
    network: 'connected'
  });

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Fetch initial data
  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setIsLoading(true);
    try {
      // Fetch products and categories
      const [productsData, categoriesData] = await Promise.all([
        fetchProducts(),
        fetchCategories()
      ]);

      setProducts(productsData);
      setCategories(categoriesData);
      setUsingMockData(false);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      // Fallback to mock data
      setProducts(mockProducts);
      setCategories(mockCategories);
      setUsingMockData(true);
    } finally {
      setIsLoading(false);
    }
  };

  // Cart management
  const addToCart = (product) => {
    setCart(prevCart => {
      const existingItem = prevCart.find(item => item.id === product.id);
      
      if (existingItem) {
        return prevCart.map(item =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      } else {
        return [...prevCart, { ...product, quantity: 1 }];
      }
    });
  };

  const updateCartQuantity = (itemId, newQuantity) => {
    if (newQuantity <= 0) {
      removeFromCart(itemId);
      return;
    }

    setCart(prevCart =>
      prevCart.map(item =>
        item.id === itemId ? { ...item, quantity: newQuantity } : item
      )
    );
  };

  const removeFromCart = (itemId) => {
    setCart(prevCart => prevCart.filter(item => item.id !== itemId));
  };

  const clearCart = () => {
    setCart([]);
  };

  const getCartTotal = () => {
    return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  };

  const getCartSummary = () => {
    const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    return {
      itemCount,
      total: getCartTotal()
    };
  };

  // Checkout handling
  const handleCheckout = () => {
    if (cart.length > 0) {
      setShowCheckout(true);
    }
  };

  const handleCheckoutSuccess = () => {
    setShowCheckout(false);
    clearCart();
    // You can add success notification here
  };

  const handleCheckoutClose = () => {
    setShowCheckout(false);
  };

  // Tab content rendering
  const renderTabContent = () => {
    switch (activeTab) {
      case 'quickshop':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ProductGrid
                products={products}
                categories={categories}
                onAddToCart={addToCart}
                isLoading={isLoading}
                usingMockData={usingMockData}
              />
            </div>
            <div>
              <CartSection
                cart={cart}
                onUpdateQuantity={updateCartQuantity}
                onRemoveItem={removeFromCart}
                onClearCart={clearCart}
                onCheckout={handleCheckout}
                usingMockData={usingMockData}
              />
            </div>
          </div>
        );

      case 'forecourt':
        return (
          <div className="bg-white rounded-xl border shadow-sm p-6">
            <div className="text-center py-12">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Forecourt Management</h3>
              <p className="text-gray-500">Fuel pump management coming soon...</p>
            </div>
          </div>
        );

      case 'drafts':
        return (
          <div className="bg-white rounded-xl border shadow-sm p-6">
            <div className="text-center py-12">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Draft Transactions</h3>
              <p className="text-gray-500">Saved transactions will appear here...</p>
            </div>
          </div>
        );

      case 'tools':
        return (
          <div className="bg-white rounded-xl border shadow-sm p-6">
            <div className="text-center py-12">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Tools & Utilities</h3>
              <p className="text-gray-500">Additional tools and settings coming soon...</p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-[calc(100vh-3rem)] flex flex-col -m-4 bg-surface">
      {/* Header */}
      <CashierHeader
        user={user}
        currentTime={currentTime}
        notifications={0}
      />

      {/* Tabs */}
      <CashierTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Main Content */}
      <main className="flex-1 p-4 overflow-auto">
        {renderTabContent()}
      </main>

      {/* Status Bar */}
      <StatusBar
        zraStatus={systemStatus.zra}
        printerStatus={systemStatus.printer}
        networkStatus={systemStatus.network}
        cartSummary={getCartSummary()}
        onCheckout={handleCheckout}
      />

      {/* Checkout Modal */}
      {showCheckout && (
        <CheckoutModal
          cart={cart}
          total={getCartTotal()}
          onSuccess={handleCheckoutSuccess}
          onClose={handleCheckoutClose}
          usingMockData={usingMockData}
        />
      )}
    </div>
  );
};

export default CashierDashboard;
