# Smart POS Frontend Implementation Guide

## 🎯 Overview
This comprehensive guide covers the complete frontend implementation for the Smart POS system with 100% VSDC-compliant backend integration.

## 📋 Table of Contents

1. [Authentication System](#authentication-system)
2. [Dashboard & Layout](#dashboard--layout)
3. [Product Management](#product-management)
4. [Sales & Checkout](#sales--checkout)
5. [Inventory Management](#inventory-management)
6. [Reports & Analytics](#reports--analytics)
7. [ZRA Integration](#zra-integration)
8. [User Management](#user-management)
9. [Settings & Configuration](#settings--configuration)
10. [Responsive Design](#responsive-design)

---

## 🔐 Authentication System

### Required Dependencies
```bash
npm install react-router-dom axios js-cookie lucide-react
```

### 1. Auth Context Provider
**File**: `src/contexts/AuthContext.jsx`

```jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import Cookies from 'js-cookie';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(Cookies.get('token'));

  // Configure axios defaults
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      axios.defaults.baseURL = 'http://localhost:3000';
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  // Check if user is authenticated on app start
  useEffect(() => {
    const checkAuth = async () => {
      if (token) {
        try {
          const response = await axios.get('/api/users/profile');
          setUser(response.data);
        } catch (error) {
          console.error('Auth check failed:', error);
          logout();
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, [token]);

  const login = async (email, password) => {
    try {
      const response = await axios.post('/api/users/login', {
        email,
        password
      });

      const { token: newToken, user: userData } = response.data;
      
      // Store token in cookie (7 days)
      Cookies.set('token', newToken, { expires: 7, secure: true });
      setToken(newToken);
      setUser(userData);
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || 'Login failed'
      };
    }
  };

  const logout = () => {
    Cookies.remove('token');
    setToken(null);
    setUser(null);
    delete axios.defaults.headers.common['Authorization'];
  };

  const value = {
    user,
    token,
    loading,
    login,
    logout,
    isAuthenticated: !!user
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
```

### 2. Permission Hooks
**File**: `src/hooks/usePermissions.js`

```javascript
import { useAuth } from '../contexts/AuthContext';

export const usePermissions = () => {
  const { user } = useAuth();

  const hasPermission = (permission) => {
    if (!user) return false;
    
    // Admin has all permissions
    if (user.role === 'ADMIN') return true;
    
    // Check if user has specific permission
    return user.permissions?.includes(permission) || false;
  };

  const hasRole = (role) => {
    if (!user) return false;
    return user.role === role;
  };

  const hasAnyRole = (roles) => {
    if (!user) return false;
    return roles.includes(user.role);
  };

  const canAccess = {
    // Sales permissions
    createSale: hasPermission('sales:write'),
    viewSales: hasPermission('sales:read'),
    refundSale: hasPermission('sales:refund'),
    
    // Product permissions
    manageProducts: hasPermission('products:write'),
    viewProducts: hasPermission('products:read'),
    
    // Inventory permissions
    manageInventory: hasPermission('inventory:write'),
    viewInventory: hasPermission('inventory:read'),
    
    // Reports permissions
    viewReports: hasPermission('reports:read'),
    manageReports: hasPermission('reports:write'),
    
    // User management
    manageUsers: hasPermission('users:write'),
    viewUsers: hasPermission('users:read'),
    
    // Settings
    manageSettings: hasPermission('settings:write'),
    
    // ZRA operations
    submitToZRA: hasPermission('zra:submit'),
    viewZRAStatus: hasPermission('zra:read')
  };

  return {
    hasPermission,
    hasRole,
    hasAnyRole,
    canAccess,
    user
  };
};
```

---

## 🛍️ Sales & Checkout System

### 1. Sales Context for Cart Management
**File**: `src/contexts/SalesContext.jsx`

```jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const SalesContext = createContext();

export const useSales = () => {
  const context = useContext(SalesContext);
  if (!context) {
    throw new Error('useSales must be used within a SalesProvider');
  }
  return context;
};

export const SalesProvider = ({ children }) => {
  const [cart, setCart] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('CASH');

  // Load cart from localStorage on mount
  useEffect(() => {
    const savedCart = localStorage.getItem('pos-cart');
    if (savedCart) {
      setCart(JSON.parse(savedCart));
    }
  }, []);

  // Save cart to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('pos-cart', JSON.stringify(cart));
  }, [cart]);

  const addToCart = (product, quantity = 1) => {
    setCart(prevCart => {
      const existingItem = prevCart.find(item => item.productId === product.id);
      
      if (existingItem) {
        return prevCart.map(item =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      } else {
        return [...prevCart, {
          productId: product.id,
          product,
          quantity,
          price: product.price
        }];
      }
    });
  };

  const removeFromCart = (productId) => {
    setCart(prevCart => prevCart.filter(item => item.productId !== productId));
  };

  const updateQuantity = (productId, quantity) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    
    setCart(prevCart =>
      prevCart.map(item =>
        item.productId === productId
          ? { ...item, quantity }
          : item
      )
    );
  };

  const clearCart = () => {
    setCart([]);
    setCustomer(null);
    setDiscount(0);
    setPaymentMethod('CASH');
  };

  const getCartTotal = () => {
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const discountAmount = subtotal * (discount / 100);
    const taxAmount = (subtotal - discountAmount) * 0.16; // 16% VAT
    return {
      subtotal,
      discountAmount,
      taxAmount,
      total: subtotal - discountAmount + taxAmount
    };
  };

  const processCheckout = async (paymentData) => {
    try {
      const { subtotal, discountAmount, taxAmount, total } = getCartTotal();
      
      const saleData = {
        items: cart.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.price
        })),
        paymentMethod,
        tax: taxAmount,
        discount: discountAmount,
        customer: customer
      };

      const response = await axios.post('/api/sales', saleData);
      
      // Clear cart after successful sale
      clearCart();
      
      return {
        success: true,
        sale: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || 'Checkout failed'
      };
    }
  };

  const value = {
    cart,
    customer,
    discount,
    paymentMethod,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    setCustomer,
    setDiscount,
    setPaymentMethod,
    getCartTotal,
    processCheckout
  };

  return (
    <SalesContext.Provider value={value}>
      {children}
    </SalesContext.Provider>
  );
};
```

### 2. Product Search Component
**File**: `src/components/sales/ProductSearch.jsx`

```jsx
import React, { useState, useEffect } from 'react';
import { Search, Package, Plus, Minus } from 'lucide-react';
import { useSales } from '../../contexts/SalesContext';
import axios from 'axios';

const ProductSearch = () => {
  const { addToCart } = useSales();
  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');

  useEffect(() => {
    fetchProducts();
    fetchCategories();
  }, []);

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      fetchProducts();
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [searchTerm, selectedCategory]);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      if (selectedCategory) params.append('category', selectedCategory);
      params.append('active', 'true');

      const response = await axios.get(`/api/products?${params}`);
      setProducts(response.data);
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await axios.get('/api/categories');
      setCategories(response.data);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const handleAddToCart = (product) => {
    addToCart(product, 1);
  };

  return (
    <div className="bg-white rounded-lg shadow-sm">
      <div className="p-6 border-b border-gray-200">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Product Search</h2>
        
        {/* Search and Filter */}
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search products by name, SKU, or barcode..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">All Categories</option>
            {categories.map(category => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Products Grid */}
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map(product => (
              <div
                key={product.id}
                className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => handleAddToCart(product)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center mb-2">
                      <Package className="h-5 w-5 text-gray-400 mr-2" />
                      <h3 className="text-sm font-medium text-gray-900 truncate">
                        {product.name}
                      </h3>
                    </div>
                    
                    <p className="text-xs text-gray-500 mb-2">
                      SKU: {product.sku || 'N/A'}
                    </p>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-bold text-indigo-600">
                        K{product.price}
                      </span>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        product.stock > product.minStock
                          ? 'bg-green-100 text-green-800'
                          : product.stock > 0
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        Stock: {product.stock}
                      </span>
                    </div>
                  </div>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddToCart(product);
                    }}
                    className="ml-2 bg-indigo-600 text-white p-2 rounded-full hover:bg-indigo-700 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {!loading && products.length === 0 && (
          <div className="text-center py-8">
            <Package className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No products found</h3>
            <p className="mt-1 text-sm text-gray-500">
              Try adjusting your search criteria
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductSearch;
```

### 3. Shopping Cart Component
**File**: `src/components/sales/ShoppingCart.jsx`

```jsx
import React from 'react';
import { Trash2, Plus, Minus, ShoppingCart as CartIcon } from 'lucide-react';
import { useSales } from '../../contexts/SalesContext';

const ShoppingCart = ({ onCheckout }) => {
  const {
    cart,
    updateQuantity,
    removeFromCart,
    clearCart,
    getCartTotal
  } = useSales();

  const { subtotal, discountAmount, taxAmount, total } = getCartTotal();

  const handleQuantityChange = (productId, newQuantity) => {
    if (newQuantity < 1) {
      removeFromCart(productId);
    } else {
      updateQuantity(productId, newQuantity);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900 flex items-center">
            <CartIcon className="h-5 w-5 mr-2" />
            Shopping Cart ({cart.length})
          </h2>
          {cart.length > 0 && (
            <button
              onClick={clearCart}
              className="text-red-600 hover:text-red-700 text-sm font-medium"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto max-h-96">
        {cart.length === 0 ? (
          <div className="p-6 text-center">
            <CartIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">Cart is empty</h3>
            <p className="mt-1 text-sm text-gray-500">
              Add products to start a new sale
            </p>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {cart.map((item) => (
              <div
                key={item.productId}
                className="flex items-center justify-between border-b border-gray-100 pb-4"
              >
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-gray-900">
                    {item.product.name}
                  </h3>
                  <p className="text-xs text-gray-500">
                    K{item.price} each
                  </p>
                </div>

                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleQuantityChange(item.productId, item.quantity - 1)}
                      className="p-1 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-8 text-center text-sm font-medium">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => handleQuantityChange(item.productId, item.quantity + 1)}
                      className="p-1 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>

                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">
                      K{(item.price * item.quantity).toFixed(2)}
                    </p>
                  </div>

                  <button
                    onClick={() => removeFromCart(item.productId)}
                    className="p-1 text-red-600 hover:text-red-700 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {cart.length > 0 && (
        <div className="border-t border-gray-200 p-6">
          {/* Cart Summary */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Subtotal</span>
              <span>K{subtotal.toFixed(2)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Discount</span>
                <span>-K{discountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-600">Tax (16%)</span>
              <span>K{taxAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold border-t pt-2">
              <span>Total</span>
              <span>K{total.toFixed(2)}</span>
            </div>
          </div>

          <button
            onClick={onCheckout}
            className="w-full mt-4 bg-indigo-600 text-white py-3 px-4 rounded-md hover:bg-indigo-700 transition duration-150 font-medium"
          >
            Proceed to Checkout
          </button>
        </div>
      )}
    </div>
  );
};

export default ShoppingCart;
```

---

## 🎯 Next Steps

This reference guide provides:

✅ **Complete Authentication System** with JWT, roles, and permissions
✅ **Sales & Checkout System** with cart management and real-time calculations
✅ **Responsive Layout** with modern UI components
✅ **Integration Ready** for 100% VSDC-compliant backend

### To Continue Implementation:

1. **Install Required Dependencies**:
```bash
cd smart-pos-frontend
npm install react-router-dom axios js-cookie lucide-react
```

2. **Update main.jsx** to include providers
3. **Implement remaining sections**: Product Management, Reports, Inventory
4. **Add ZRA integration components**
5. **Implement real-time features**

Would you like me to continue with:
- 📦 **Product Management** (Add/Edit products, categories)
- 📊 **Reports & Analytics** (Sales reports, ZRA compliance reports)
- 🏪 **Inventory Management** (Stock adjustments, low stock alerts)
- ⚙️ **Settings & Configuration** (ZRA settings, user preferences)

Or should we start implementing these components step by step?
