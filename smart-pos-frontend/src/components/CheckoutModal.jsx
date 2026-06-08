import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Banknote,
  CreditCard,
  Smartphone,
  Landmark,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Printer,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { createSale, submitToZRA, mapPaymentMethod } from '../api/cashierApi';
import { useAuth } from '../contexts/AuthContext';

const VAT_RATE = 0.16;

const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash', shortcut: '1', icon: Banknote, hint: 'Physical cash payment' },
  { id: 'card', label: 'Card', shortcut: '2', icon: CreditCard, hint: 'Credit / debit card' },
  { id: 'mobile', label: 'Mobile', shortcut: '3', icon: Smartphone, hint: 'MTN / Airtel money' },
  { id: 'bank', label: 'Bank', shortcut: '4', icon: Landmark, hint: 'Direct bank transfer' },
];

const STEP = {
  METHOD: 1,
  DETAILS: 2,
  CONFIRM: 3,
  RECEIPT: 4,
};

const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    minimumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);

const CheckoutModal = ({ cart = [], total: totalProp, onClose, onSuccess, usingMockData = false }) => {
  const { user } = useAuth();

  const totals = useMemo(() => {
    const cartTotal =
      totalProp ?? cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
    const vat = cartTotal * VAT_RATE;
    const subtotal = cartTotal - vat;
    return { total: cartTotal, vat, subtotal };
  }, [cart, totalProp]);

  const [step, setStep] = useState(STEP.METHOD);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [cardLast4, setCardLast4] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [customerInfo, setCustomerInfo] = useState({ name: '', phone: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [zraState, setZraState] = useState('idle'); // idle | submitting | submitted | failed
  const [zraReceipt, setZraReceipt] = useState(null);
  const [saleId, setSaleId] = useState(null);

  const detailRef = useRef(null);

  const change = useMemo(() => {
    if (paymentMethod !== 'cash') return 0;
    const received = parseFloat(cashReceived);
    if (Number.isNaN(received)) return 0;
    return Math.max(0, received - totals.total);
  }, [paymentMethod, cashReceived, totals.total]);

  const canAdvanceFromDetails = useMemo(() => {
    switch (paymentMethod) {
      case 'cash':
        return parseFloat(cashReceived) >= totals.total;
      case 'card':
        return /^\d{4}$/.test(cardLast4);
      case 'mobile':
        return /^\d{9,15}$/.test(mobileNumber.replace(/\s/g, ''));
      case 'bank':
        return true;
      default:
        return false;
    }
  }, [paymentMethod, cashReceived, cardLast4, mobileNumber, totals.total]);

  // Keyboard shortcuts: ESC close, 1-4 method select on first step
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && step !== STEP.RECEIPT) {
        onClose?.();
      }
      if (step === STEP.METHOD) {
        const match = PAYMENT_METHODS.find((m) => m.shortcut === e.key);
        if (match) setPaymentMethod(match.id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step, onClose]);

  // Auto-focus first input on details step
  useEffect(() => {
    if (step === STEP.DETAILS && detailRef.current) {
      detailRef.current.focus();
    }
  }, [step]);

  const goNext = () => {
    setError(null);
    if (step === STEP.METHOD) {
      setStep(STEP.DETAILS);
      return;
    }
    if (step === STEP.DETAILS) {
      if (!canAdvanceFromDetails) {
        setError(
          paymentMethod === 'cash'
            ? `Insufficient cash. Need ${formatCurrency(totals.total)}.`
            : 'Please complete the payment details.'
        );
        return;
      }
      setStep(STEP.CONFIRM);
      return;
    }
  };

  const goBack = () => {
    setError(null);
    if (step === STEP.DETAILS) setStep(STEP.METHOD);
    else if (step === STEP.CONFIRM) setStep(STEP.DETAILS);
  };

  const submitSale = async () => {
    if (!user?.id) {
      setError('You must be logged in to complete a sale.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        userId: user.id,
        items: cart.map((item) => ({
          productId: item.id,
          quantity: item.quantity,
          price: item.price,
        })),
        paymentMethod: mapPaymentMethod(paymentMethod),
        tax: totals.vat,
        discount: 0,
        customerInfo,
        paymentDetails: {
          method: paymentMethod,
          cashReceived: paymentMethod === 'cash' ? parseFloat(cashReceived) : null,
          change: paymentMethod === 'cash' ? change : null,
          cardLast4: paymentMethod === 'card' ? cardLast4 : null,
          mobileNumber: paymentMethod === 'mobile' ? mobileNumber : null,
        },
      };

      const sale = await createSale(payload);
      setSaleId(sale.id);

      if (!usingMockData) {
        setZraState('submitting');
        try {
          const zra = await submitToZRA(sale.id);
          setZraReceipt(zra?.receiptNumber || zra?.rcptNo || zra?.zraReceiptNumber || 'OK');
          setZraState('submitted');
        } catch (zraErr) {
          console.warn('ZRA submission failed:', zraErr);
          setZraState('failed');
        }
      } else {
        setZraState('submitted');
        setZraReceipt('MOCK');
      }

      setStep(STEP.RECEIPT);
    } catch (err) {
      console.error('Payment processing failed:', err);
      setError(err.message || 'Payment processing failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleComplete = () => {
    onSuccess?.(saleId);
    onClose?.();
  };

  const renderStepDots = () => (
    <div className="flex items-center gap-1.5">
      {[STEP.METHOD, STEP.DETAILS, STEP.CONFIRM].map((s) => (
        <span
          key={s}
          className={`h-1.5 w-6 rounded-full ${
            step >= s ? 'bg-gray-800' : 'bg-gray-300'
          }`}
        />
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl panel bg-white overflow-hidden">
        {/* Header */}
        <div className="panel-header flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              {step === STEP.RECEIPT ? 'Sale completed' : 'Checkout'}
            </h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {cart.length} {cart.length === 1 ? 'line' : 'lines'} · Total{' '}
              <span className="font-mono font-medium text-gray-700">
                {formatCurrency(totals.total)}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {step !== STEP.RECEIPT && renderStepDots()}
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost p-1.5"
              disabled={submitting}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="panel-body space-y-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="flex items-start gap-2 border border-red-200 bg-red-50 text-red-800 text-xs p-2 rounded">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* STEP 1 — METHOD */}
          {step === STEP.METHOD && (
            <div className="space-y-4">
              <div>
                <div className="label-sys">Select payment method</div>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_METHODS.map((m) => {
                    const Icon = m.icon;
                    const active = paymentMethod === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPaymentMethod(m.id)}
                        className={`flex items-start gap-3 p-3 rounded border text-left transition-colors ${
                          active
                            ? 'border-gray-800 bg-gray-50'
                            : 'border-surface-border bg-white hover:border-gray-400'
                        }`}
                      >
                        <Icon className="w-4 h-4 mt-0.5 text-gray-700" strokeWidth={1.5} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">{m.label}</span>
                            <kbd className="text-[10px] font-mono px-1.5 py-0.5 border border-surface-border rounded text-gray-500">
                              {m.shortcut}
                            </kbd>
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">{m.hint}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="label-sys">Customer (optional)</div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Name"
                    value={customerInfo.name}
                    onChange={(e) =>
                      setCustomerInfo({ ...customerInfo, name: e.target.value })
                    }
                    className="input-sys"
                  />
                  <input
                    type="tel"
                    placeholder="Phone"
                    value={customerInfo.phone}
                    onChange={(e) =>
                      setCustomerInfo({ ...customerInfo, phone: e.target.value })
                    }
                    className="input-sys"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2 — DETAILS */}
          {step === STEP.DETAILS && (
            <div className="space-y-4">
              <div className="text-xs text-gray-500">
                Paying by <span className="font-medium text-gray-700">
                  {PAYMENT_METHODS.find((m) => m.id === paymentMethod)?.label}
                </span>
                {' · '}
                <span className="font-mono">{formatCurrency(totals.total)}</span>
              </div>

              {paymentMethod === 'cash' && (
                <div className="space-y-3">
                  <div>
                    <label className="label-sys">Cash received</label>
                    <input
                      ref={detailRef}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={cashReceived}
                      onChange={(e) => setCashReceived(e.target.value)}
                      className="input-sys font-mono"
                    />
                  </div>
                  <div className="flex justify-between text-sm border-t border-surface-border pt-3">
                    <span className="text-gray-600">Change due</span>
                    <span
                      className={`font-mono font-medium ${
                        change > 0 ? 'text-emerald-700' : 'text-gray-900'
                      }`}
                    >
                      {formatCurrency(change)}
                    </span>
                  </div>
                </div>
              )}

              {paymentMethod === 'card' && (
                <div>
                  <label className="label-sys">Card last 4 digits</label>
                  <input
                    ref={detailRef}
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="1234"
                    value={cardLast4}
                    onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, ''))}
                    className="input-sys font-mono tracking-widest"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    For receipt reference only. Full PAN is captured by the card terminal.
                  </p>
                </div>
              )}

              {paymentMethod === 'mobile' && (
                <div>
                  <label className="label-sys">Mobile money number</label>
                  <input
                    ref={detailRef}
                    type="tel"
                    placeholder="0976 123 456"
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(e.target.value)}
                    className="input-sys font-mono"
                  />
                </div>
              )}

              {paymentMethod === 'bank' && (
                <div className="border border-surface-border bg-gray-50 rounded p-3 text-xs text-gray-600">
                  Confirm bank transfer is received before completing the sale.
                </div>
              )}
            </div>
          )}

          {/* STEP 3 — CONFIRM */}
          {step === STEP.CONFIRM && (
            <div className="space-y-4">
              <div className="border border-surface-border rounded">
                <div className="px-3 py-2 border-b border-surface-border text-[11px] font-medium uppercase tracking-wide text-gray-500 bg-gray-50">
                  Items
                </div>
                <ul className="divide-y divide-surface-border">
                  {cart.map((item) => (
                    <li
                      key={item.id}
                      className="flex justify-between px-3 py-1.5 text-xs"
                    >
                      <span className="text-gray-700">
                        {item.name} × {item.quantity}
                      </span>
                      <span className="font-mono text-gray-900">
                        {formatCurrency(item.price * item.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border border-surface-border rounded p-3 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="font-mono">{formatCurrency(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">VAT 16%</span>
                  <span className="font-mono">{formatCurrency(totals.vat)}</span>
                </div>
                <div className="flex justify-between border-t border-surface-border pt-1 mt-1">
                  <span className="font-medium text-gray-900">Total</span>
                  <span className="font-mono font-semibold text-gray-900">
                    {formatCurrency(totals.total)}
                  </span>
                </div>
              </div>

              <div className="border border-surface-border rounded p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Method</span>
                  <span className="font-medium text-gray-800">
                    {PAYMENT_METHODS.find((m) => m.id === paymentMethod)?.label}
                  </span>
                </div>
                {paymentMethod === 'cash' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Received</span>
                      <span className="font-mono">{formatCurrency(parseFloat(cashReceived) || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Change</span>
                      <span className="font-mono text-emerald-700">{formatCurrency(change)}</span>
                    </div>
                  </>
                )}
                {paymentMethod === 'card' && cardLast4 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Card</span>
                    <span className="font-mono">···· {cardLast4}</span>
                  </div>
                )}
                {paymentMethod === 'mobile' && mobileNumber && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Mobile</span>
                    <span className="font-mono">{mobileNumber}</span>
                  </div>
                )}
                {customerInfo.name && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Customer</span>
                    <span>{customerInfo.name}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 4 — RECEIPT */}
          {step === STEP.RECEIPT && (
            <div className="space-y-4 text-center py-2">
              <div className="flex justify-center">
                <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" strokeWidth={1.5} />
                </div>
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-900">
                  {formatCurrency(totals.total)} captured
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  Sale ID <span className="font-mono">{saleId}</span>
                </div>
              </div>

              <div className="border border-surface-border rounded p-3 text-xs text-left max-w-xs mx-auto space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Method</span>
                  <span>{PAYMENT_METHODS.find((m) => m.id === paymentMethod)?.label}</span>
                </div>
                {paymentMethod === 'cash' && change > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Change to customer</span>
                    <span className="font-mono">{formatCurrency(change)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">ZRA</span>
                  <span
                    className={`font-medium ${
                      zraState === 'submitted'
                        ? 'text-emerald-700'
                        : zraState === 'failed'
                        ? 'text-amber-700'
                        : 'text-gray-700'
                    }`}
                  >
                    {zraState === 'submitted'
                      ? `Submitted${zraReceipt && zraReceipt !== 'OK' ? ` · ${zraReceipt}` : ''}`
                      : zraState === 'failed'
                      ? 'Failed — will retry'
                      : 'Pending'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-4 py-3 border-t border-surface-border flex items-center justify-between gap-2">
          {step === STEP.RECEIPT ? (
            <>
              <button
                type="button"
                onClick={() => window.print()}
                className="btn-secondary"
              >
                <Printer className="w-4 h-4" /> Print receipt
              </button>
              <button type="button" onClick={handleComplete} className="btn-primary">
                New sale <ArrowRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={step === STEP.METHOD ? onClose : goBack}
                className="btn-secondary"
                disabled={submitting}
              >
                {step === STEP.METHOD ? (
                  'Cancel'
                ) : (
                  <>
                    <ArrowLeft className="w-4 h-4" /> Back
                  </>
                )}
              </button>

              {step !== STEP.CONFIRM ? (
                <button type="button" onClick={goNext} className="btn-primary">
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submitSale}
                  disabled={submitting}
                  className="btn-primary"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Processing…
                    </>
                  ) : (
                    <>
                      Complete payment <CheckCircle2 className="w-4 h-4" />
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CheckoutModal;
