import { useState, useEffect } from 'react'
import Dashboard from './components/Dashboard'
import ProductSearch from './components/ProductSearch'
import ShoppingCart from './components/ShoppingCart'
import CheckoutModal from './components/CheckoutModal'
import NotificationToast from './components/NotificationToast'
import KeyboardShortcuts from './components/KeyboardShortcuts'

function App() {
  const [cart, setCart] = useState([])
  const [showCheckout, setShowCheckout] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [currentUser] = useState({
    name: 'John Doe',
    role: 'Cashier',
    shift: 'Morning',
    avatar: '👤'
  })

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'f':
            e.preventDefault()
            document.querySelector('#search-input')?.focus()
            break
          case 'Enter':
            e.preventDefault()
            if (cart.length > 0) setShowCheckout(true)
            break
          case 'Escape':
            e.preventDefault()
            setShowCheckout(false)
            break
          case '?':
            e.preventDefault()
            setShowShortcuts(true)
            break
          case 'Delete':
            e.preventDefault()
            if (confirm('Clear entire cart?')) clearCart()
            break
        }
      }
      
      // Function keys
      if (e.key === 'F11') {
        e.preventDefault()
        toggleFullscreen()
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [cart])

  const addNotification = (message, type = 'success') => {
    const id = Date.now()
    setNotifications(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id))
    }, 3000)
  }

  const addToCart = (product, quantity = 1) => {
    setCart(prev => {
      const existingItem = prev.find(item => item.id === product.id)
      if (existingItem) {
        addNotification(`Updated ${product.name} quantity`, 'info')
        return prev.map(item =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        )
      }
      addNotification(`Added ${product.name} to cart`, 'success')
      return [...prev, { ...product, quantity }]
    })
  }

  const updateCartItem = (productId, quantity) => {
    if (quantity <= 0) {
      setCart(prev => prev.filter(item => item.id !== productId))
      addNotification('Item removed from cart', 'warning')
    } else {
      setCart(prev =>
        prev.map(item =>
          item.id === productId ? { ...item, quantity } : item
        )
      )
    }
  }

  const removeFromCart = (productId) => {
    const item = cart.find(item => item.id === productId)
    setCart(prev => prev.filter(item => item.id !== productId))
    addNotification(`Removed ${item?.name} from cart`, 'warning')
  }

  const clearCart = () => {
    setCart([])
    addNotification('Cart cleared', 'info')
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  const cartTotal = cart.reduce((total, item) => total + (item.price * item.quantity), 0)
  const cartItemCount = cart.reduce((total, item) => total + item.quantity, 0)

  return (
    <div className={`min-h-screen transition-all duration-300 ${isDarkMode ? 'dark bg-gray-900' : 'bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50'}`}>
      {/* Enhanced Header */}
      <header className="glass shadow-lg border-b border-white/20 sticky top-0 z-40">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="text-2xl">🏪</div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  Smart POS Pro
                </h1>
                <p className="text-sm text-gray-600 flex items-center">
                  <span className="mr-2">{currentUser.avatar}</span>
                  {currentUser.name} • {currentUser.role}
                </p>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-700">{currentUser.shift} Shift</p>
                <p className="text-xs text-gray-500">{new Date().toLocaleDateString()}</p>
              </div>
              
              {/* Action Buttons */}
              <div className="flex space-x-2">
                <button
                  onClick={() => setShowShortcuts(true)}
                  className="p-2 rounded-lg bg-white/50 hover:bg-white/70 transition-all duration-200"
                  title="Keyboard Shortcuts (Ctrl+?)"
                >
                  ⌨️
                </button>
                <button
                  onClick={toggleFullscreen}
                  className="p-2 rounded-lg bg-white/50 hover:bg-white/70 transition-all duration-200"
                  title="Toggle Fullscreen (F11)"
                >
                  {isFullscreen ? '🗗' : '⛶'}
                </button>
                <button
                  onClick={() => setIsDarkMode(!isDarkMode)}
                  className="p-2 rounded-lg bg-white/50 hover:bg-white/70 transition-all duration-200"
                  title="Toggle Dark Mode"
                >
                  {isDarkMode ? '🌞' : '🌙'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex flex-col lg:flex-row min-h-screen">
        {/* Left Panel - Dashboard & Product Search */}
        <div className="flex-1 flex flex-col animate-slide-in-left">
          <Dashboard />
          <ProductSearch onAddToCart={addToCart} />
        </div>

        {/* Right Panel - Shopping Cart */}
        <div className="w-full lg:w-96 glass border-l border-white/20 animate-slide-in-right">
          <ShoppingCart
            cart={cart}
            total={cartTotal}
            itemCount={cartItemCount}
            onUpdateItem={updateCartItem}
            onRemoveItem={removeFromCart}
            onCheckout={() => setShowCheckout(true)}
            onClearCart={clearCart}
          />
        </div>
      </div>

      {/* Floating Action Button for Mobile Checkout */}
      {cart.length > 0 && (
        <div className="fixed bottom-4 right-4 lg:hidden z-30">
          <button
            onClick={() => setShowCheckout(true)}
            className="w-16 h-16 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-110 animate-bounce-in"
          >
            <div className="text-center">
              <div className="text-lg">💳</div>
              <div className="text-xs">{cartItemCount}</div>
            </div>
          </button>
        </div>
      )}

      {/* Modals & Overlays */}
      {showCheckout && (
        <CheckoutModal
          cart={cart}
          total={cartTotal}
          onClose={() => setShowCheckout(false)}
          onSuccess={() => {
            clearCart()
            addNotification('Sale completed successfully!', 'success')
          }}
        />
      )}

      {showShortcuts && (
        <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />
      )}

      {/* Notification Toast Container */}
      <div className="fixed top-20 right-4 z-50 space-y-2">
        {notifications.map(notification => (
          <NotificationToast
            key={notification.id}
            message={notification.message}
            type={notification.type}
            onClose={() => setNotifications(prev => prev.filter(n => n.id !== notification.id))}
          />
        ))}
      </div>

      {/* Loading Overlay (when needed) */}
      {/* <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="glass p-6 rounded-xl">
          <div className="spinner mx-auto mb-4"></div>
          <p className="text-gray-700">Processing...</p>
        </div>
      </div> */}
    </div>
  )
}

export default App
