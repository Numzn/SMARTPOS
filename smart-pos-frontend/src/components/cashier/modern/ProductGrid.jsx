import React, { useEffect, useRef, useState } from 'react';
import { Search, Package, AlertCircle } from 'lucide-react';
import { getCashierStockStatus, isProductLowStock, isProductRegisteredForSale } from '../../../utils/productUtils';

const ProductGrid = ({
  products = [],
  categories = [],
  onAddToCart,
  isLoading = false,
  usingMockData = false
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  // Toggles a border/shadow on the sticky search bar once the grid has
  // actually scrolled underneath it — a flat sentinel just above the bar
  // (observed via IntersectionObserver) leaves view exactly when the bar
  // "sticks", so this needs no scroll-position math of its own.
  const [stuck, setStuck] = useState(false);
  const sentinelRef = useRef(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const filteredProducts = products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         product.sku?.toLowerCase().includes(searchTerm.toLowerCase());
    const productCategory = typeof product.category === 'object' ? product.category.name : product.category;
    const matchesCategory = selectedCategory === 'all' || productCategory === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    switch (sortBy) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'price':
        return a.price - b.price;
      case 'stock':
        return a.stock - b.stock;
      default:
        return 0;
    }
  });

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-ZM', {
      style: 'currency',
      currency: 'ZMW',
      minimumFractionDigits: 2
    }).format(amount);
  };

  if (isLoading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <div className="h-6 bg-gray-200 rounded w-32 animate-pulse"></div>
          <div className="h-6 bg-gray-200 rounded w-24 animate-pulse"></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <div key={i} className="bg-gray-100 rounded-lg p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded mb-2"></div>
              <div className="h-6 bg-gray-200 rounded mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-2/3"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // No card chrome (border/shadow/header bar) — this fills the pane between
  // the top bar and the cart as one continuous surface, the same way a
  // kiosk product browser does. The search/filter row is the one thing that
  // stays pinned (position: sticky) while the grid below it scrolls.
  return (
    <div>
      <div ref={sentinelRef} />
      <div
        className={`sticky top-0 z-10 bg-white lg:-mx-3 lg:px-3 py-2 flex flex-wrap items-center gap-2 transition-shadow ${
          stuck ? 'border-b border-surface-border shadow-sm' : 'border-b border-transparent'
        }`}
      >
        <span className="text-xs text-gray-500 shrink-0">
          Products · {sortedProducts.length}
        </span>
        {usingMockData && (
          <span className="status-pill border-amber-200 bg-amber-50 text-amber-800 shrink-0">
            <AlertCircle className="w-3 h-3" />
            Demo data
          </span>
        )}

        <div className="flex-1 min-w-[160px] relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search products or SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-sys pl-9"
          />
        </div>

        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="input-sys w-auto shrink-0"
        >
          <option value="all">All Categories</option>
          {categories.map(category => (
            <option key={category.id} value={category.name}>
              {category.name}
            </option>
          ))}
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="input-sys w-auto shrink-0"
        >
          <option value="name">Sort by Name</option>
          <option value="price">Sort by Price</option>
          <option value="stock">Sort by Stock</option>
        </select>
      </div>

      {/* Products Grid */}
      {sortedProducts.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pt-4">
          {sortedProducts.map((product) => {
            const stockStatus = getCashierStockStatus(product);
            const registered = isProductRegisteredForSale(product);
            const canAdd = product.stock > 0 && registered;

            return (
              <div
                key={product.id}
                className={`relative border border-surface-border rounded p-3 bg-white ${
                  canAdd ? 'hover:border-gray-400 cursor-pointer' : 'opacity-75 cursor-not-allowed'
                }`}
                onClick={() => canAdd && onAddToCart(product)}
                title={!registered ? 'Not registered with ZRA — cannot sell' : undefined}
              >
                {!registered && (
                  <div className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-medium bg-yellow-50 border border-yellow-200 text-yellow-800">
                    Not registered
                  </div>
                )}
                {registered && stockStatus && (
                  <div
                    className={`absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-medium ${stockStatus.bg} ${stockStatus.color}`}
                    aria-label={stockStatus.label}
                  >
                    {stockStatus.label}
                  </div>
                )}

                {/* Product Image Placeholder */}
                <div className="w-full h-16 bg-gray-100 border border-surface-border mb-2 flex items-center justify-center">
                  <Package className="w-6 h-6 text-gray-400" strokeWidth={1.5} />
                </div>

                {/* Product Info */}
                <div className="space-y-2">
                  <h4 className="font-medium text-gray-900 text-sm line-clamp-2">
                    {product.name}
                  </h4>

                  <div className="flex items-center justify-between">
                    <span className="text-lg font-semibold text-gray-900">
                      {formatCurrency(product.price)}
                    </span>
                    <span className="text-xs text-gray-500">
                      SKU: {product.sku}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span className={
                      product.stock <= 0
                        ? 'text-red-600 font-medium'
                        : isProductLowStock(product)
                          ? 'text-orange-600 font-medium'
                          : ''
                    }>
                      Stock: {product.stock}
                      {product.minStockLevel > 0 && isProductLowStock(product) && (
                        <span className="text-gray-400 font-normal"> (min {product.minStockLevel})</span>
                      )}
                    </span>
                    <span>{typeof product.category === 'object' ? product.category?.name : product.category}</span>
                  </div>

                  {/* Add to Cart Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canAdd) onAddToCart(product);
                    }}
                    disabled={!canAdd}
                    className="btn-primary w-full mt-2 text-xs py-1.5 disabled:opacity-50"
                  >
                    {!registered ? 'Not registered' : product.stock > 0 ? 'Add to Cart' : 'Out of Stock'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12">
          <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No products found</h3>
          <p className="text-gray-500">
            {searchTerm ? 'Try adjusting your search terms' : 'No products available'}
          </p>
        </div>
      )}
    </div>
  );
};

export default ProductGrid;
