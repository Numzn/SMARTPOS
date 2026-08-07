import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import CashierHeader from './CashierHeader';
import CashierTabs from './CashierTabs';
import ProductGrid from './ProductGrid';
import CartSection from './CartSection';
import StatusBar from './StatusBar';
import CheckoutModal from '../../CheckoutModal';
import {
  fetchProducts,
  fetchCategories,
  fetchVsdcStatus,
  mockProducts,
  mockCategories,
} from '../../../api/cashierApi';
import { fetchPrinterStatus } from '../../../api/printersApi';
import { mapPrinterStatusLabel } from '../../../lib/printReceipt';
import { calculateCartTotals } from '../../../utils/cartTotals';

const CashierDashboard = () => {
  const [activeTab, setActiveTab] = useState('quickshop');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showCheckout, setShowCheckout] = useState(false);
  const [usingMockData, setUsingMockData] = useState(false);

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cart, setCart] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const [discountType, setDiscountType] = useState('percentage');
  const [discountValue, setDiscountValue] = useState('');

  const [zraStatus, setZraStatus] = useState('checking');
  const [printerStatus, setPrinterStatus] = useState('unknown');
  const [networkStatus] = useState('connected');
  const [stockNotice, setStockNotice] = useState('');

  // Silent refresh plumbing. Refs rather than state: these only coordinate
  // the polling loop and must never themselves trigger a re-render, which on
  // a till would mean the grid twitching under the cashier's finger.
  const refreshInFlight = useRef(false);
  const showCheckoutRef = useRef(false);
  showCheckoutRef.current = showCheckout;

  const cartTotals = useMemo(
    () => calculateCartTotals(cart, { discountType, discountValue }),
    [cart, discountType, discountValue]
  );

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadVsdc = async () => {
      try {
        const status = await fetchVsdcStatus();
        if (!cancelled) {
          setZraStatus(status.initialized ? 'connected' : 'not initialized');
        }
      } catch {
        if (!cancelled) setZraStatus('offline');
      }
    };

    loadVsdc();
    const interval = setInterval(loadVsdc, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadPrinter = async () => {
      try {
        const status = await fetchPrinterStatus();
        if (!cancelled) {
          setPrinterStatus(mapPrinterStatusLabel(status));
        }
      } catch {
        if (!cancelled) setPrinterStatus('unknown');
      }
    };

    loadPrinter();
    const interval = setInterval(loadPrinter, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const fetchInitialData = async () => {
    setIsLoading(true);
    try {
      const [productsData, categoriesData] = await Promise.all([
        fetchProducts(),
        fetchCategories(),
      ]);
      setProducts(productsData);
      setCategories(categoriesData);
      setUsingMockData(false);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      setProducts(mockProducts);
      setCategories(mockCategories);
      setUsingMockData(true);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Refresh product stock without disturbing the screen.
   *
   * Deliberately not fetchInitialData(): that flips isLoading, which makes
   * ProductGrid swap the whole grid for a loading state — unusable mid-service.
   * It also falls back to mock products on failure, so a momentary network
   * blip would silently replace the real catalogue with demo data. A refresh
   * keeps the last good data instead and simply tries again next tick.
   */
  const refreshProductsSilently = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const productsData = await fetchProducts();
      if (Array.isArray(productsData) && productsData.length > 0) {
        setProducts(productsData);
        setUsingMockData(false);
      }
    } catch {
      // Intentionally silent: stale stock for one tick is far better than an
      // error toast interrupting a queue, and the next tick will recover.
    } finally {
      refreshInFlight.current = false;
    }
  }, []);

  // Keep the till live. Paused while the tab is hidden (a till is often left
  // open all day) and while checkout is open, so stock can't shift under a
  // transaction that is already being confirmed.
  useEffect(() => {
    const POLL_MS = 20000;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (showCheckoutRef.current) return;
      refreshProductsSilently();
    };
    const interval = setInterval(tick, POLL_MS);
    // Catch up immediately when the cashier returns to the tab.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshProductsSilently();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshProductsSilently]);

  const getAvailableStock = (productId) =>
    products.find((product) => product.id === productId)?.stock ?? 0;

  const showStockNotice = (message) => {
    setStockNotice(message);
    window.setTimeout(() => setStockNotice(''), 3000);
  };

  const addToCart = (product) => {
    if (product.stock <= 0) {
      showStockNotice(`${product.name} is out of stock.`);
      return;
    }

    setCart((prevCart) => {
      const existingItem = prevCart.find((item) => item.id === product.id);
      const nextQuantity = (existingItem?.quantity ?? 0) + 1;

      if (nextQuantity > product.stock) {
        showStockNotice(`Only ${product.stock} of ${product.name} available.`);
        return prevCart;
      }

      if (existingItem) {
        return prevCart.map((item) =>
          item.id === product.id ? { ...item, quantity: nextQuantity } : item
        );
      }
      return [...prevCart, { ...product, quantity: 1 }];
    });
  };

  const updateCartQuantity = (itemId, newQuantity) => {
    if (newQuantity <= 0) {
      removeFromCart(itemId);
      return;
    }

    const availableStock = getAvailableStock(itemId);
    const cappedQuantity = Math.min(newQuantity, availableStock);

    if (cappedQuantity < newQuantity) {
      const item = cart.find((entry) => entry.id === itemId);
      showStockNotice(`Only ${availableStock} of ${item?.name || 'this item'} available.`);
    }

    setCart((prevCart) =>
      prevCart.map((item) => (item.id === itemId ? { ...item, quantity: cappedQuantity } : item))
    );
  };

  const removeFromCart = (itemId) => {
    setCart((prevCart) => prevCart.filter((item) => item.id !== itemId));
  };

  const clearCart = () => {
    setCart([]);
    setDiscountValue('');
  };

  const handleCheckout = () => {
    if (cart.length > 0) {
      setShowCheckout(true);
    }
  };

  const handleCheckoutSuccess = () => {
    setShowCheckout(false);
    clearCart();
    // The sale just consumed stock; pull the new figures immediately rather
    // than leaving the next customer to be served against pre-sale numbers.
    refreshProductsSilently();
  };

  const handleCheckoutClose = () => {
    setShowCheckout(false);
  };

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
                discountType={discountType}
                discountValue={discountValue}
                onDiscountTypeChange={setDiscountType}
                onDiscountValueChange={setDiscountValue}
                usingMockData={usingMockData}
                getAvailableStock={getAvailableStock}
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
    <div className="h-full flex flex-col bg-surface">
      <CashierHeader currentTime={currentTime} />

      <CashierTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {stockNotice && (
        <div className="mx-4 mt-3 px-3 py-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded">
          {stockNotice}
        </div>
      )}

      <main className="flex-1 p-4 overflow-auto">{renderTabContent()}</main>

      <StatusBar
        zraStatus={zraStatus}
        printerStatus={printerStatus}
        networkStatus={networkStatus}
        cartSummary={{ itemCount: cartTotals.itemCount, total: cartTotals.total }}
        onCheckout={handleCheckout}
      />

      {showCheckout && (
        <CheckoutModal
          cart={cart}
          cartTotals={cartTotals}
          onSuccess={handleCheckoutSuccess}
          onClose={handleCheckoutClose}
          usingMockData={usingMockData}
        />
      )}
    </div>
  );
};

export default CashierDashboard;
