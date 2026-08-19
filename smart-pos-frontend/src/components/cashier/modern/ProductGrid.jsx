import React, { useEffect, useRef, useState } from 'react';
import { Search, Package, AlertCircle, ChevronDown, Check, Filter } from 'lucide-react';
import { getCashierStockStatus, isProductLowStock, isProductRegisteredForSale } from '../../../utils/productUtils';

const AVAILABILITY_VIEWS = [
  { id: 'inStock', label: 'In Stock' },
  { id: 'all', label: 'All Products' },
  { id: 'outOfStock', label: 'Out of Stock' },
];

// A compact trigger + positioned option list, closing on outside click —
// the shared shape behind both the availability view and category filter
// controls, so a cashier gets one consistent dropdown pattern rather than
// a native <select> for one and something else for another.
const CompactMenu = ({ trigger, children, align = 'left' }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={containerRef}>
      {trigger(() => setOpen((v) => !v), open)}
      {open && (
        <div
          className={`absolute top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'} z-20 min-w-[170px] panel py-1`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
};

const MenuOption = ({ selected, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-gray-700 hover:bg-gray-50"
  >
    <Check className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-surface-accent' : 'text-transparent'}`} />
    {children}
  </button>
);

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
  // A view of the catalog, not a filter the cashier has to manage — In
  // Stock is the default because the cashier's job is "find something,
  // add it to the sale," and most of a real catalog is out-of-stock or
  // unregistered noise between the handful of sellable products. All
  // Products / Out of Stock are deliberate, occasional switches, not
  // states requiring a permanent toggle to reach.
  const [availabilityView, setAvailabilityView] = useState('inStock');
  // Toggles a border/shadow on the header once the grid below it has
  // actually scrolled. The header lives outside the scrolling box
  // entirely (a plain always-visible row, not position:sticky) — an
  // earlier sticky-inside-overflow-auto version hit a real Chromium
  // paint bug where scrolled-past grid rows stayed visibly painted
  // above the stuck bar instead of being clipped. This structure (two
  // separate boxes: a fixed header, a fully separate scrolling region)
  // sidesteps that whole class of bug rather than working around it.
  const [scrolled, setScrolled] = useState(false);
  const scrollRef = useRef(null);

  const handleScroll = () => {
    setScrolled((scrollRef.current?.scrollTop || 0) > 0);
  };

  // The same "can this be sold right now" condition every product card
  // already checks for its own badge/button state — In Stock / Out of
  // Stock are just this predicate and its complement, not new logic.
  const isSellable = (product) => product.stock > 0 && isProductRegisteredForSale(product);

  const filteredProducts = products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         product.sku?.toLowerCase().includes(searchTerm.toLowerCase());
    const productCategory = typeof product.category === 'object' ? product.category.name : product.category;
    const matchesCategory = selectedCategory === 'all' || productCategory === selectedCategory;
    const matchesAvailability =
      availabilityView === 'all' ? true : availabilityView === 'inStock' ? isSellable(product) : !isSellable(product);
    return matchesSearch && matchesCategory && matchesAvailability;
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

  const availabilityLabel = AVAILABILITY_VIEWS.find((v) => v.id === availabilityView)?.label;

  // No card chrome (border/shadow/header bar) — this fills the pane between
  // the top bar and the cart as one continuous surface, the same way a
  // kiosk product browser does. Only the grid below the search/filter row
  // scrolls; the row itself always stays in view.
  return (
    <div className="h-full flex flex-col">
      <div
        className={`shrink-0 bg-white pb-3 flex flex-wrap items-center gap-2 transition-shadow ${
          scrolled ? 'border-b border-surface-border shadow-sm' : 'border-b border-transparent'
        }`}
      >
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

        <CompactMenu
          trigger={(toggle) => (
            <button type="button" onClick={toggle} className="input-sys w-auto flex items-center gap-1.5">
              {availabilityLabel}
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            </button>
          )}
        >
          {(close) =>
            AVAILABILITY_VIEWS.map((view) => (
              <MenuOption
                key={view.id}
                selected={availabilityView === view.id}
                onClick={() => {
                  setAvailabilityView(view.id);
                  close();
                }}
              >
                {view.label}
              </MenuOption>
            ))
          }
        </CompactMenu>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="input-sys w-auto shrink-0"
        >
          <option value="name">Sort by Name</option>
          <option value="price">Sort by Price</option>
          <option value="stock">Sort by Stock</option>
        </select>

        <CompactMenu
          align="right"
          trigger={(toggle) => (
            <button type="button" onClick={toggle} className="input-sys w-auto flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-gray-400" />
              Filter
              {selectedCategory !== 'all' && <span className="w-1.5 h-1.5 rounded-full bg-surface-accent" />}
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuOption selected={selectedCategory === 'all'} onClick={() => { setSelectedCategory('all'); close(); }}>
                All Categories
              </MenuOption>
              {categories.map((category) => (
                <MenuOption
                  key={category.id}
                  selected={selectedCategory === category.name}
                  onClick={() => {
                    setSelectedCategory(category.name);
                    close();
                  }}
                >
                  {category.name}
                </MenuOption>
              ))}
            </>
          )}
        </CompactMenu>

        <span className="text-xs text-gray-500 shrink-0 ml-auto">
          {sortedProducts.length} product{sortedProducts.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto scroll-thin">
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
            <h3 className="text-lg font-medium text-gray-900 mb-2">No products available</h3>
            <p className="text-gray-500 mb-4">
              Try changing the availability view or clearing your search.
            </p>
            {availabilityView !== 'all' && (
              <button
                type="button"
                onClick={() => setAvailabilityView('all')}
                className="btn-secondary"
              >
                View all products
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductGrid;
