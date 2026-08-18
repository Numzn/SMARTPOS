import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import CashierTopBar from './CashierTopBar';
import ProductGrid from './ProductGrid';
import CartSection from './CartSection';
import StatusBar from './StatusBar';
import CheckoutModal from '../../CheckoutModal';
import SupervisorApprovalModal from './SupervisorApprovalModal';
import CashMovementModal from '../../shifts/CashMovementModal';
import SubmitDeclarationModal from '../../shifts/SubmitDeclarationModal';
import OpeningCashPrompt from '../../shifts/OpeningCashPrompt';
import { useEndShiftFlow } from '../../../hooks/useEndShiftFlow';
import { useShiftInitialization } from '../../../hooks/useShiftInitialization';
import { usePermissions } from '../../../hooks/usePermissions';
import { shiftApi } from '../../../services/shiftService';
import {
  fetchProducts,
  fetchCategories,
  mockProducts,
  mockCategories,
  openTillSession,
  scanItem,
  reverseLine,
  abandonTillSession,
  fetchDiscountPolicy,
} from '../../../api/cashierApi';
import { fetchPrinterStatus } from '../../../api/printersApi';
import { mapPrinterStatusLabel } from '../../../lib/printReceipt';
import { calculateCartTotals } from '../../../utils/cartTotals';
import { useOnlineStatus } from '../../../hooks/useOnlineStatus';

const CashierDashboard = () => {
  const { canAccess } = usePermissions();
  // MainLayout polls this once for the whole session (see useZraStatus.js)
  // and hands it down via Outlet context — this used to be a local poller
  // here, which reset to 'checking' every time /cashier unmounted/remounted.
  const { zraStatus = 'checking' } = useOutletContext() || {};
  // Auto-creates/resumes the caller's shift on load (INITIALIZING or OPEN) —
  // the canonical implementation of how a shift starts, replacing a manual
  // "Open Shift" button. useEndShiftFlow (unchanged, still the canonical
  // implementation of how a shift ends) needs refreshKey wired to this
  // hook's status: it fetches the current shift once on its own mount, so
  // without this it stays stuck showing "no open shift" for a few seconds
  // after shiftInit flips INITIALIZING -> OPEN, until something unrelated
  // happens to re-render.
  const shiftInit = useShiftInitialization({ enabled: canAccess.operateShift });
  const endShiftFlow = useEndShiftFlow({ enabled: canAccess.operateShift, refreshKey: shiftInit.shift?.status });
  // Shift & Cash tools — Cash In/Out, Paid Out, Safe Drop on the currently
  // open shift. Separate from endShiftFlow's own saving state since these
  // are independent actions with their own modal.
  const [movementType, setMovementType] = useState(null);
  const [movementSaving, setMovementSaving] = useState(false);
  const [movementError, setMovementError] = useState('');
  const [declarationSaving, setDeclarationSaving] = useState(false);
  const [declarationError, setDeclarationError] = useState('');
  const [activeTab, setActiveTab] = useState('quickshop');
  const [showCheckout, setShowCheckout] = useState(false);
  const [usingMockData, setUsingMockData] = useState(false);

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cart, setCart] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const [discountType, setDiscountType] = useState('percentage');
  const [discountValue, setDiscountValue] = useState('');
  // NUMZ discount policy (not a ZRA rule) — fail-closed default (false)
  // until the real policy loads, so an unauthorized control never flashes.
  const [discountAllowed, setDiscountAllowed] = useState(false);

  // Till-lock (POS Control Phase 1) — the server-committed cart backing
  // this on-screen one. Opened lazily on the first scan of a transaction,
  // consumed by a successful checkout, abandoned on an explicit clear.
  const [tillSessionId, setTillSessionId] = useState(null);
  // A pending decrease/removal awaiting supervisor approval — set opens
  // SupervisorApprovalModal; { productId, toQuantity, name }.
  const [pendingReversal, setPendingReversal] = useState(null);

  // { state, name } — name is the configured printer's own label (real data
  // from PrinterProfile), shown in the top bar's status tooltip when known.
  const [printerStatus, setPrinterStatus] = useState({ state: 'unknown', name: null });
  const online = useOnlineStatus();
  const [stockNotice, setStockNotice] = useState('');

  // Dedupes concurrent ensureTillSession() calls — two rapid add-to-cart
  // clicks before tillSessionId state has updated would otherwise both see
  // it as null and each open their own orphaned session.
  const sessionOpenPromiseRef = useRef(null);

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
    fetchInitialData();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchDiscountPolicy()
      .then((res) => {
        if (!cancelled) setDiscountAllowed(Boolean(res.canApply || res.canRequest));
      })
      .catch(() => {
        // Fail closed — stays hidden if the policy can't be loaded.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadPrinter = async () => {
      try {
        const status = await fetchPrinterStatus();
        if (!cancelled) {
          setPrinterStatus({ state: mapPrinterStatusLabel(status), name: status?.printer?.name || null });
        }
      } catch {
        if (!cancelled) setPrinterStatus({ state: 'unknown', name: null });
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

  // "Shift sealed — Z-000184 generated" confirmation, matching the existing
  // "no financial figures shown to the cashier" discipline — endShiftFlow
  // never exposes expected cash/variance, only the Z-number.
  useEffect(() => {
    if (endShiftFlow.lastZNumber) {
      showStockNotice(`Shift sealed — ${endShiftFlow.lastZNumber} generated`);
    }
  }, [endShiftFlow.lastZNumber]);

  // POS Control Phase 1 — the committed cart is server state, opened lazily
  // on the first scan of a transaction so browsing never creates an empty
  // session. Mock/demo mode (no real backend) is exempt — free local editing,
  // exactly as before this feature existed.
  const ensureTillSession = async () => {
    if (tillSessionId) return tillSessionId;
    if (!sessionOpenPromiseRef.current) {
      sessionOpenPromiseRef.current = openTillSession()
        .then(({ session }) => {
          setTillSessionId(session.id);
          return session.id;
        })
        .finally(() => {
          sessionOpenPromiseRef.current = null;
        });
    }
    return sessionOpenPromiseRef.current;
  };

  const addToCart = async (product) => {
    if (product.stock <= 0) {
      showStockNotice(`${product.name} is out of stock.`);
      return;
    }

    const existingItem = cart.find((item) => item.id === product.id);
    const nextQuantity = (existingItem?.quantity ?? 0) + 1;
    if (nextQuantity > product.stock) {
      showStockNotice(`Only ${product.stock} of ${product.name} available.`);
      return;
    }

    if (!usingMockData) {
      try {
        const sessionId = await ensureTillSession();
        await scanItem(sessionId, { productId: product.id, quantity: 1, unitPrice: product.price });
      } catch (err) {
        showStockNotice(err?.data?.error || err.message || `Could not add ${product.name}.`);
        return;
      }
    }

    setCart((prevCart) => {
      const existing = prevCart.find((item) => item.id === product.id);
      if (existing) {
        return prevCart.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prevCart, { ...product, quantity: 1 }];
    });
  };

  /**
   * Increasing quantity is always free (scanItem, no approval). Decreasing
   * or removing an already-committed line opens SupervisorApprovalModal via
   * pendingReversal — see handleReversalApproved for the actual mutation.
   */
  const updateCartQuantity = (itemId, newQuantity) => {
    const item = cart.find((entry) => entry.id === itemId);
    if (!item) return;

    if (newQuantity <= 0) {
      removeFromCart(itemId);
      return;
    }

    if (newQuantity <= item.quantity) {
      setPendingReversal({ productId: itemId, toQuantity: newQuantity, name: item.name });
      return;
    }

    const availableStock = getAvailableStock(itemId);
    const cappedQuantity = Math.min(newQuantity, availableStock);
    if (cappedQuantity < newQuantity) {
      showStockNotice(`Only ${availableStock} of ${item.name} available.`);
    }
    const delta = cappedQuantity - item.quantity;
    if (delta <= 0) return;

    if (usingMockData) {
      setCart((prevCart) =>
        prevCart.map((entry) => (entry.id === itemId ? { ...entry, quantity: cappedQuantity } : entry))
      );
      return;
    }

    scanItem(tillSessionId, { productId: itemId, quantity: delta, unitPrice: item.price })
      .then(() => {
        setCart((prevCart) =>
          prevCart.map((entry) => (entry.id === itemId ? { ...entry, quantity: cappedQuantity } : entry))
        );
      })
      .catch((err) => showStockNotice(err?.data?.error || err.message || 'Could not update quantity.'));
  };

  const removeFromCart = (itemId) => {
    const item = cart.find((entry) => entry.id === itemId);
    if (!item) return;
    if (usingMockData) {
      setCart((prevCart) => prevCart.filter((entry) => entry.id !== itemId));
      return;
    }
    setPendingReversal({ productId: itemId, toQuantity: 0, name: item.name });
  };

  const handleReversalApproved = async ({ approvalId, reasonCode, reasonNote }) => {
    const { productId, toQuantity } = pendingReversal;
    try {
      await reverseLine(tillSessionId, productId, { toQuantity, approvalId, reasonCode, reasonNote });
      setCart((prevCart) =>
        toQuantity <= 0
          ? prevCart.filter((entry) => entry.id !== productId)
          : prevCart.map((entry) => (entry.id === productId ? { ...entry, quantity: toQuantity } : entry))
      );
    } catch (err) {
      showStockNotice(err?.data?.error || err.message || 'Reversal failed.');
    } finally {
      setPendingReversal(null);
    }
  };

  // Shift & Cash tools tab — Cash In/Out, Paid Out, Safe Drop against the
  // currently open shift. Safe Drop is its own movement type (SAFE_DROP),
  // not a relabeled Cash Out, so it routes through recordSafeDrop.
  const handleCashMovement = async ({ amount, reason }) => {
    if (!endShiftFlow.shift) return;
    setMovementSaving(true);
    setMovementError('');
    try {
      if (movementType === 'SAFE_DROP') {
        await shiftApi.recordSafeDrop(endShiftFlow.shift.id, { amount, reason });
      } else {
        await shiftApi.recordCashMovement(endShiftFlow.shift.id, movementType, { amount, reason });
      }
      setMovementType(null);
    } catch (err) {
      setMovementError(err?.data?.error || err.message || 'Failed to record cash movement');
    } finally {
      setMovementSaving(false);
    }
  };

  // Right after ending a shift — the one moment a plain Cashier (lacking
  // shifts:viewAll/shifts:reconcile) can address their own just-ended shift
  // at all, since GET /shifts/current only ever returns an OPEN shift and
  // there's no list permission to find it again later.
  const handleSubmitDeclaration = async ({ declaredTotal }) => {
    setDeclarationSaving(true);
    setDeclarationError('');
    try {
      await shiftApi.submitDeclaration(endShiftFlow.lastEndedShiftId, { declaredTotal });
      endShiftFlow.dismissEndedNotice();
    } catch (err) {
      setDeclarationError(err?.data?.error || err.message || 'Failed to submit declaration');
    } finally {
      setDeclarationSaving(false);
    }
  };

  const clearCart = () => {
    if (tillSessionId) {
      abandonTillSession(tillSessionId).catch(() => {}); // best-effort; local state clears regardless
    }
    setCart([]);
    setDiscountValue('');
    setTillSessionId(null);
  };

  // After a successful checkout, the session is already CONSUMED server-side
  // (see lib/saleFiscal.js) — this just resets local state for the next sale,
  // deliberately not clearCart(), which would call abandonTillSession on an
  // already-consumed session for no reason.
  const resetCartAfterSale = () => {
    setCart([]);
    setDiscountValue('');
    setTillSessionId(null);
  };

  const handleCheckout = () => {
    if (cart.length > 0) {
      setShowCheckout(true);
    }
  };

  const handleCheckoutSuccess = () => {
    setShowCheckout(false);
    resetCartAfterSale();
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
        // Below lg, this is a plain stacked column and <main> scrolls the
        // whole tab normally (mobile has no room for a fixed side panel).
        // At lg+, it becomes a fixed-height row: only the product grid
        // scrolls internally, the cart pane stays fully in view the whole
        // time — a cashier shouldn't have to scroll away from their cart
        // just to browse more products.
        return (
          <div className="flex flex-col gap-6 lg:flex-row lg:gap-3 lg:h-full lg:min-h-0">
            <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto scroll-thin lg:px-3 lg:py-2">
              <ProductGrid
                products={products}
                categories={categories}
                onAddToCart={addToCart}
                isLoading={isLoading}
                usingMockData={usingMockData}
              />
            </div>
            <div className="lg:w-[380px] lg:shrink-0 lg:h-full lg:min-h-0 lg:py-2 lg:pr-3">
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
                discountAllowed={usingMockData || discountAllowed}
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
            <h3 className="text-lg font-medium text-gray-900 mb-1">Shift & Cash</h3>
            <p className="text-sm text-gray-500 mb-5">
              Cash movements and ending your shift — this is the canonical place for these actions.
            </p>

            {!canAccess.operateShift ? (
              <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-4">
                You don&apos;t have permission to operate a shift.
              </div>
            ) : endShiftFlow.loading ? (
              <div className="text-sm text-gray-500">Loading shift…</div>
            ) : !endShiftFlow.shift ? (
              <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-4">
                No open shift right now — reload this page and it will start one automatically.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">OPEN</span>
                  <span className="text-sm text-gray-600">
                    {endShiftFlow.shift.shiftNumber || endShiftFlow.shift.id}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setMovementType('CASH_IN')}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cash In
                  </button>
                  <button
                    onClick={() => setMovementType('CASH_OUT')}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cash Out
                  </button>
                  <button
                    onClick={() => setMovementType('PAID_OUT')}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Paid Out
                  </button>
                  <button
                    onClick={() => setMovementType('SAFE_DROP')}
                    className="px-4 py-2 border border-indigo-300 rounded-md text-sm font-medium text-indigo-700 hover:bg-indigo-50"
                  >
                    Safe Drop
                  </button>
                  {/* Ending a shift is PIN-gated (useEndShiftFlow ->
                      SupervisorApprovalModal), not permission-gated — this
                      is the canonical, only place to initiate it. */}
                  <button
                    onClick={endShiftFlow.requestEndShift}
                    disabled={endShiftFlow.ending}
                    className="px-4 py-2 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
                  >
                    {endShiftFlow.ending ? 'Ending…' : 'End Shift'}
                  </button>
                </div>
                {(movementError || endShiftFlow.error) && (
                  <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
                    {movementError || endShiftFlow.error}
                  </div>
                )}
              </>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  // Blocks normal till operation until opening cash is confirmed — the
  // opening-cash prompt replaces the tabs/product-grid/status-bar entirely,
  // there's nothing to operate yet.
  const isInitializing = canAccess.operateShift && shiftInit.shift?.status === 'INITIALIZING';

  return (
    <div className="h-full flex flex-col bg-surface">
      <CashierTopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        showTabs={!isInitializing}
        printerStatus={printerStatus}
        zraStatus={zraStatus}
        online={online}
      />

      {isInitializing ? (
        <OpeningCashPrompt
          shiftNumber={shiftInit.shift?.shiftNumber}
          confirming={shiftInit.confirming}
          error={shiftInit.error}
          onConfirm={shiftInit.confirmOpening}
        />
      ) : (
        <>
          {stockNotice && (
            <div className="mx-4 mt-3 px-3 py-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded">
              {stockNotice}
            </div>
          )}

          <main
            className={`flex-1 p-4 overflow-auto ${activeTab === 'quickshop' ? 'lg:overflow-hidden lg:p-0' : ''}`}
          >
            {renderTabContent()}
          </main>

          <StatusBar
            cartSummary={{ itemCount: cartTotals.itemCount, total: cartTotals.total }}
            onCheckout={handleCheckout}
          />
        </>
      )}

      {showCheckout && (
        <CheckoutModal
          cart={cart}
          cartTotals={cartTotals}
          tillSessionId={tillSessionId}
          onSuccess={handleCheckoutSuccess}
          onClose={handleCheckoutClose}
          usingMockData={usingMockData}
        />
      )}

      <SupervisorApprovalModal
        open={Boolean(pendingReversal)}
        onClose={() => setPendingReversal(null)}
        actionType="LINE_REVERSAL"
        sessionId={tillSessionId}
        target={
          pendingReversal
            ? {
                productId: pendingReversal.productId,
                quantity:
                  (cart.find((item) => item.id === pendingReversal.productId)?.quantity ?? 0) -
                  pendingReversal.toQuantity,
              }
            : undefined
        }
        itemLabel={pendingReversal?.name}
        onApproved={handleReversalApproved}
      />

      <SupervisorApprovalModal
        open={endShiftFlow.modalOpen}
        onClose={endShiftFlow.closeModal}
        actionType="SHIFT_END"
        target={endShiftFlow.shift ? { shiftId: endShiftFlow.shift.id } : undefined}
        itemLabel={endShiftFlow.shift ? `Shift ${endShiftFlow.shift.shiftNumber || endShiftFlow.shift.id}` : undefined}
        onApproved={endShiftFlow.handleApproved}
      />

      <CashMovementModal
        show={!!movementType}
        type={movementType}
        onClose={() => setMovementType(null)}
        loading={movementSaving}
        onSubmit={handleCashMovement}
      />

      <SubmitDeclarationModal
        show={!!endShiftFlow.lastEndedShiftId}
        shiftLabel={endShiftFlow.lastZNumber}
        onClose={endShiftFlow.dismissEndedNotice}
        loading={declarationSaving}
        error={declarationError}
        onSubmit={handleSubmitDeclaration}
      />
    </div>
  );
};

export default CashierDashboard;
