import React, { useState, useEffect, useCallback } from 'react';
import { useSales } from '../../contexts/SalesContext';

const ProductSearch = () => {
  const { addToCart } = useSales();
  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      // Mock data for now - replace with actual API calls
      const mockProducts = [
        {
          id: '1',
          name: 'Coca Cola 500ml',
          price: 15.50,
          sku: 'CC500',
          stock: 45,
          minStock: 10,
          category: 'Beverages'
        },
        {
          id: '2',
          name: 'Bread Loaf',
          price: 12.00,
          sku: 'BL001',
          stock: 25,
          minStock: 5,
          category: 'Bakery'
        },
        {
          id: '3',
          name: 'Cooking Oil 2L',
          price: 85.75,
          sku: 'CO2L',
          stock: 8,
          minStock: 10,
          category: 'Cooking'
        }
      ];

      // Filter by search term
      let filtered = mockProducts;
      if (searchTerm) {
        filtered = mockProducts.filter(product =>
          product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          product.sku.toLowerCase().includes(searchTerm.toLowerCase())
        );
      }

      if (selectedCategory) {
        const selectedCategoryName = categories.find((c) => c.id === selectedCategory)?.name;
        filtered = selectedCategoryName
          ? filtered.filter((product) => product.category === selectedCategoryName)
          : filtered;
      }

      setProducts(filtered);
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, selectedCategory, categories]);

  const fetchCategories = useCallback(async () => {
    try {
      // Mock categories
      setCategories([
        { id: '1', name: 'Beverages' },
        { id: '2', name: 'Bakery' },
        { id: '3', name: 'Cooking' }
      ]);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      fetchProducts();
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [fetchProducts]);

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
            <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">🔍</span>
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
                      <span className="text-gray-400 mr-2">📦</span>
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
                    ➕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {!loading && products.length === 0 && (
          <div className="text-center py-8">
            <span className="mx-auto text-4xl text-gray-400">📦</span>
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
