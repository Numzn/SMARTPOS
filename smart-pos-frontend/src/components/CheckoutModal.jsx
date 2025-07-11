import { useState, useEffect, useRef } from 'react'

const CheckoutModal = ({ cart, total, onClose, onSuccess }) => {
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [cashReceived, setCashReceived] = useState('')
  const [cardDetails, setCardDetails] = useState({ number: '', expiry: '', cvv: '' })
  const [mobileNumber, setMobileNumber] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [showReceipt, setShowReceipt] = useState(false)
  const [saleId, setSaleId] = useState(null)
  const [paymentStatus, setPaymentStatus] = useState('pending')
  const [step, setStep] = useState(1) // 1: Payment, 2: Processing, 3: Receipt
  const cashInputRef = useRef(null)

  const vatAmount = total * 0.16
  const subtotal = total - vatAmount
  const change = paymentMethod === 'cash' ? Math.max(0, parseFloat(cashReceived) - total) : 0

  const paymentMethods = [
    { id: 'cash', name: 'Cash', icon: '💵', description: 'Physical cash payment' },
    { id: 'card', name: 'Card', icon: '💳', description: 'Credit/Debit card' },
    { id: 'mobile', name: 'Mobile Money', icon: '📱', description: 'MTN/Airtel Money' },
    { id: 'bank', name: 'Bank Transfer', icon: '🏦', description: 'Direct bank transfer' }
  ]

  // Auto-focus cash input when cash is selected
  useEffect(() => {
    if (paymentMethod === 'cash' && cashInputRef.current) {
      cashInputRef.current.focus()
    }
  }, [paymentMethod])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'Escape') {
        onClose()
      }
      if (e.key === 'Enter' && !isProcessing) {
        handlePayment()
      }
      // Quick payment method selection
      if (e.key === '1') setPaymentMethod('cash')
      if (e.key === '2') setPaymentMethod('card')
      if (e.key === '3') setPaymentMethod('mobile')
      if (e.key === '4') setPaymentMethod('bank')
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [isProcessing])

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-ZM', {
      style: 'currency',
      currency: 'ZMW',
      minimumFractionDigits: 2
    }).format(amount)
  }

  const validatePayment = () => {
    switch (paymentMethod) {
      case 'cash':
        return parseFloat(cashReceived) >= total
      case 'card':
        return cardDetails.number.length >= 16 && cardDetails.expiry && cardDetails.cvv.length >= 3
      case 'mobile':
        return mobileNumber.length >= 10
      case 'bank':
        return true // Bank transfers are typically pre-authorized
      default:
        return false
    }
  }

  const handlePayment = async () => {
    if (!validatePayment()) {
      if (paymentMethod === 'cash') {
        alert('Insufficient cash received')
      } else {
        alert('Please complete all required payment fields')
      }
      return
    }

    setIsProcessing(true)
    setStep(2)

    try {
      // Simulate different payment processing times
      const processingTime = paymentMethod === 'cash' ? 1000 : 3000
      
      // This would be an API call to your backend
      // const response = await fetch('/api/sales', { 
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ 
      //     cart, 
      //     paymentMethod, 
      //     total, 
      //     customerInfo,
      //     cashReceived: paymentMethod === 'cash' ? cashReceived : null,
      //     cardDetails: paymentMethod === 'card' ? cardDetails : null,
      //     mobileNumber: paymentMethod === 'mobile' ? mobileNumber : null
      //   })
      // })
      
      await new Promise(resolve => setTimeout(resolve, processingTime))
      
      // Simulate occasional payment failures for demo
      if (Math.random() < 0.1) {
        throw new Error('Payment declined. Please try again.')
      }
      
      const mockSaleId = 'INV-' + Date.now()
      setSaleId(mockSaleId)
      setPaymentStatus('completed')
      setStep(3)
      setShowReceipt(true)
      
    } catch (error) {
      setPaymentStatus('failed')
      alert(error.message || 'Payment failed. Please try again.')
      setStep(1)
    } finally {
      setIsProcessing(false)
    }
  }

  const handlePrintReceipt = async () => {
    // Simulate printing delay
    setIsProcessing(true)
    await new Promise(resolve => setTimeout(resolve, 1000))
    setIsProcessing(false)
    
    // This would integrate with your POS printer API
    alert('Receipt printed successfully!')
    onSuccess()
    onClose()
  }

  const handleEmailReceipt = async () => {
    const email = prompt('Enter email address for receipt:')
    if (email) {
      setIsProcessing(true)
      await new Promise(resolve => setTimeout(resolve, 1000))
      setIsProcessing(false)
      
      // This would send email via your backend
      alert(`Receipt sent to ${email}!`)
      onSuccess()
      onClose()
    }
  }

  const QuickCashButtons = () => {
    const quickAmounts = [
      Math.ceil(total),
      Math.ceil(total / 10) * 10,
      Math.ceil(total / 20) * 20,
      Math.ceil(total / 50) * 50
    ].filter((amount, index, arr) => arr.indexOf(amount) === index && amount > total)

    return (
      <div className="grid grid-cols-2 gap-2 mt-2">
        {quickAmounts.slice(0, 4).map(amount => (
          <button
            key={amount}
            onClick={() => setCashReceived(amount.toString())}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm transition-colors"
          >
            {formatCurrency(amount)}
          </button>
        ))}
      </div>
    )
  }

  // Processing Step
  if (step === 2) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-md w-full p-8 text-center">
          <div className="animate-spin w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Processing Payment</h2>
          <p className="text-gray-600 mb-4">Please wait while we process your {paymentMethod} payment...</p>
          <div className="text-2xl font-bold text-blue-600">{formatCurrency(total)}</div>
        </div>
      </div>
    )
  }

  // Receipt Step
  if (showReceipt && step === 3) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-md w-full max-h-screen overflow-y-auto animate-bounce-in">
          <div className="p-6">
            <div className="text-center mb-6">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">✅</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Payment Successful!</h2>
              <p className="text-gray-600">Invoice: {saleId}</p>
              <p className="text-sm text-gray-500">{new Date().toLocaleString()}</p>
            </div>

            {/* Enhanced Receipt Preview */}
            <div className="bg-gray-50 p-4 rounded-lg mb-6 text-sm font-mono">
              <div className="text-center mb-4 border-b border-gray-300 pb-2">
                <h3 className="font-bold text-lg">🏪 SMART POS PRO</h3>
                <p>123 Business Street, Lusaka</p>
                <p>Phone: +260 XXX XXX XXX</p>
                <p>VAT No: 123456789</p>
              </div>

              <div className="mb-4">
                <p><strong>Invoice:</strong> {saleId}</p>
                <p><strong>Date:</strong> {new Date().toLocaleString()}</p>
                <p><strong>Cashier:</strong> John Doe</p>
                <p><strong>Payment:</strong> {paymentMethod.toUpperCase()}</p>
              </div>

              <div className="border-t border-gray-300 pt-2 mb-4">
                <div className="flex justify-between font-bold mb-1">
                  <span>ITEM</span>
                  <span>QTY</span>
                  <span>PRICE</span>
                  <span>TOTAL</span>
                </div>
                {cart.map(item => (
                  <div key={item.id} className="flex justify-between py-1 text-xs">
                    <span className="truncate flex-1">{item.name}</span>
                    <span className="w-8 text-center">{item.quantity}</span>
                    <span className="w-16 text-right">{formatCurrency(item.price)}</span>
                    <span className="w-16 text-right">{formatCurrency(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-300 pt-2">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>VAT (16%):</span>
                  <span>{formatCurrency(vatAmount)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg border-t mt-1 pt-1">
                  <span>TOTAL:</span>
                  <span>{formatCurrency(total)}</span>
                </div>
                
                {paymentMethod === 'cash' && (
                  <>
                    <div className="flex justify-between mt-2">
                      <span>Cash Received:</span>
                      <span>{formatCurrency(parseFloat(cashReceived))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Change:</span>
                      <span>{formatCurrency(change)}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="text-center mt-4 pt-2 border-t border-gray-300">
                <p className="text-xs">Thank you for your business!</p>
                <p className="text-xs">Visit us again soon</p>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={handlePrintReceipt}
                disabled={isProcessing}
                className="w-full btn-primary flex items-center justify-center"
              >
                {isProcessing ? <span className="spinner mr-2"></span> : '🖨️ '}
                Print Receipt
              </button>
              <button
                onClick={handleEmailReceipt}
                disabled={isProcessing}
                className="w-full btn-secondary"
              >
                📧 Email Receipt
              </button>
              <button
                onClick={() => {
                  onSuccess()
                  onClose()
                }}
                className="w-full text-gray-600 hover:text-gray-800 py-2"
              >
                Continue without Receipt
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Payment Step
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-lg w-full max-h-screen overflow-y-auto animate-slide-in-right">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900">💳 Checkout</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 text-2xl"
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>

          {/* Order Summary */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-semibold mb-3 flex items-center">
              📋 Order Summary
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Items ({cart.length}):</span>
                <span>{cart.reduce((sum, item) => sum + item.quantity, 0)} products</span>
              </div>
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>VAT (16%):</span>
                <span>{formatCurrency(vatAmount)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold border-t pt-2 text-green-600">
                <span>Total:</span>
                <span>{formatCurrency(total)}</span>
              </div>
            </div>
          </div>

          {/* Payment Method Selection */}
          <div className="mb-6">
            <h3 className="font-semibold mb-3 flex items-center">
              💰 Payment Method
              <span className="text-xs text-gray-500 ml-2">(Press 1-4 for quick selection)</span>
            </h3>
            <div className="grid grid-cols-1 gap-3">
              {paymentMethods.map((method, index) => (
                <button
                  key={method.id}
                  onClick={() => setPaymentMethod(method.id)}
                  className={`p-4 rounded-lg border text-left transition-all duration-200 ${
                    paymentMethod === method.id
                      ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                      : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="text-2xl">{method.icon}</div>
                      <div>
                        <div className="font-medium">{method.name}</div>
                        <div className="text-sm text-gray-500">{method.description}</div>
                      </div>
                    </div>
                    <div className="text-xs bg-gray-200 px-2 py-1 rounded">
                      {index + 1}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Payment Details */}
          <div className="mb-6">
            {paymentMethod === 'cash' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Cash Received *
                </label>
                <input
                  ref={cashInputRef}
                  type="number"
                  step="0.01"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  placeholder="0.00"
                  className="input-field text-lg font-bold"
                />
                <QuickCashButtons />
                {cashReceived && (
                  <div className="mt-3 p-3 bg-green-50 rounded-lg">
                    <div className="flex justify-between text-sm">
                      <span>Amount Due:</span>
                      <span className="font-medium">{formatCurrency(total)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Cash Received:</span>
                      <span className="font-medium">{formatCurrency(parseFloat(cashReceived) || 0)}</span>
                    </div>
                    <div className={`flex justify-between text-lg font-bold ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      <span>Change:</span>
                      <span>{formatCurrency(change)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {paymentMethod === 'card' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Card Number *
                  </label>
                  <input
                    type="text"
                    value={cardDetails.number}
                    onChange={(e) => setCardDetails(prev => ({ ...prev, number: e.target.value.replace(/\D/g, '') }))}
                    placeholder="1234 5678 9012 3456"
                    className="input-field"
                    maxLength="16"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Expiry *
                    </label>
                    <input
                      type="text"
                      value={cardDetails.expiry}
                      onChange={(e) => setCardDetails(prev => ({ ...prev, expiry: e.target.value }))}
                      placeholder="MM/YY"
                      className="input-field"
                      maxLength="5"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      CVV *
                    </label>
                    <input
                      type="text"
                      value={cardDetails.cvv}
                      onChange={(e) => setCardDetails(prev => ({ ...prev, cvv: e.target.value.replace(/\D/g, '') }))}
                      placeholder="123"
                      className="input-field"
                      maxLength="4"
                    />
                  </div>
                </div>
              </div>
            )}

            {paymentMethod === 'mobile' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Mobile Money Number *
                </label>
                <input
                  type="tel"
                  value={mobileNumber}
                  onChange={(e) => setMobileNumber(e.target.value)}
                  placeholder="+260 XXX XXX XXX"
                  className="input-field"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Supports MTN Money, Airtel Money
                </p>
              </div>
            )}

            {paymentMethod === 'bank' && (
              <div className="p-4 bg-blue-50 rounded-lg">
                <h4 className="font-medium text-blue-900 mb-2">Bank Transfer Instructions</h4>
                <p className="text-sm text-blue-800">
                  Please confirm the bank transfer has been completed before proceeding.
                </p>
              </div>
            )}
          </div>

          {/* Process Payment Button */}
          <button
            onClick={handlePayment}
            disabled={isProcessing || !validatePayment()}
            className={`w-full py-4 rounded-lg font-semibold text-lg transition-all duration-200 ${
              isProcessing || !validatePayment()
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'btn-success transform hover:scale-105'
            }`}
          >
            {isProcessing ? (
              <span className="flex items-center justify-center">
                <span className="spinner mr-2"></span>
                Processing...
              </span>
            ) : (
              `💳 Process Payment - ${formatCurrency(total)}`
            )}
          </button>

          <p className="text-xs text-gray-500 text-center mt-3">
            Press Enter to process payment • Press Esc to cancel
          </p>
        </div>
      </div>
    </div>
  )
}

export default CheckoutModal
