import React, { useState } from 'react';
import { Search, Filter, Package, AlertCircle } from 'lucide-react';

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

  const getStockStatus = (stock) => {
    if (stock <= 0) return { status: 'out', color: 'text-red-600', bg: 'bg-red-50' };
    if (stock <= 10) return { status: 'low', color: 'text-orange-600', bg: 'bg-orange-50' };
    return { status: 'in', color: 'text-green-600', bg: 'bg-green-50' };
  };

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
      <div className="bg-white rounded-xl border shadow-sm p-6">
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

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">
            Products · {sortedProducts.length}
          </h3>
        </div>
        {usingMockData && (
          <span className="status-pill border-amber-200 bg-amber-50 text-amber-800">
            <AlertCircle className="w-3 h-3" />
            Demo data
          </span>
        )}
      </div>
      <div className="panel-body">

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        {/* Search */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search products or SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-sys pl-9"
          />
        </div>

        {/* Category Filter */}
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="input-sys"
        >
          <option value="all">All Categories</option>
          {categories.map(category => (
            <option key={category.id} value={category.name}>
              {category.name}
            </option>
          ))}
        </select>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="input-sys"
        >
          <option value="name">Sort by Name</option>
          <option value="price">Sort by Price</option>
          <option value="stock">Sort by Stock</option>
        </select>
      </div>

      {/* Products Grid */}
      {sortedProducts.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {sortedProducts.map((product) => {
            const stockStatus = getStockStatus(product.stock);
            
            return (
              <div
                key={product.id}
                className="border border-surface-border rounded p-3 hover:border-gray-400 bg-white cursor-pointer"
                onClick={() => onAddToCart(product)}
              >
                {/* Stock Status Badge */}
                <div className={`absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-medium ${stockStatus.bg} ${stockStatus.color}`}>
                  {stockStatus.status === 'out' ? 'Out of Stock' : 
                   stockStatus.status === 'low' ? 'Low Stock' : 'In Stock'}
                </div>

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
                    <span>Stock: {product.stock}</span>
                    <span>{typeof product.category === 'object' ? product.category.name : product.category}</span>
                  </div>

                  {/* Add to Cart Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddToCart(product);
                    }}
                    disabled={product.stock <= 0}
                    className="btn-primary w-full mt-2 text-xs py-1.5"
                  >
                    {product.stock > 0 ? 'Add to Cart' : 'Out of Stock'}
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
    </div>
  );
};

export default ProductGrid;

