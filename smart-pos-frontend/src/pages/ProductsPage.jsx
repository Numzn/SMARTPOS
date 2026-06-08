import React, { useState, useEffect, useCallback } from 'react';
import ProductModal from '../components/ProductModal';
import ProductsTable from '../components/ProductsTable';
import { productApi, categoryApi, inventoryApi } from '../services/productService';
import { 
  validateProductForm, 
  filterProducts, 
  exportProductsToCSV, 
  getInitialProductData, 
  vatCategories, 
  getInventoryInfo, 
  getStockStatus, 
  navigateToInventory 
} from '../utils/productUtils';

const ProductsPage = () => {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBy, setFilterBy] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [errors, setErrors] = useState({});
  const [productData, setProductData] = useState(getInitialProductData());

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const loadInitialData = useCallback(async () => {
    try {
      await Promise.all([
        fetchProducts(),
        fetchCategories(),
        fetchInventoryOverview()
      ]);
    } catch (error) {
      console.error('Error loading initial data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProducts = async () => {
    try {
      const data = await productApi.fetchProducts();
      setProducts(data);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  };

  const fetchCategories = async () => {
    try {
      console.log('📋 Starting to fetch categories...');
      const data = await categoryApi.fetchCategories();
      console.log('Categories fetched:', data);
      setCategories(data);
      
      // If no categories exist, create some default ones
      if (!data || data.length === 0) {
        console.log('No categories found, creating default categories...');
        try {
          const createdCategories = await categoryApi.createDefaultCategories();
          if (createdCategories && createdCategories.length > 0) {
            setCategories(createdCategories);
            console.log('Default categories created successfully:', createdCategories);
          }
        } catch (createError) {
          console.error('Error creating default categories:', createError);
          // Set some fallback categories if creation fails
          setCategories([
            { id: 'temp-1', name: 'General', description: 'General products' },
            { id: 'temp-2', name: 'Food & Beverages', description: 'Food items and drinks' }
          ]);
        }
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
      // Set fallback categories if fetch fails
      setCategories([
        { id: 'temp-1', name: 'General', description: 'General products' },
        { id: 'temp-2', name: 'Food & Beverages', description: 'Food items and drinks' }
      ]);
    }
  };

  const fetchInventoryOverview = async () => {
    try {
      const data = await inventoryApi.fetchInventoryOverview();
      setInventory(data);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    }
  };

  const validateForm = () => {
    const newErrors = validateProductForm(productData);
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreateProduct = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const result = await productApi.createProduct(productData);
      setShowAddModal(false);
      resetProductData();
      fetchProducts();
      alert(result.message || 'Product created successfully!');
    } catch (error) {
      console.error('Error creating product:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProduct = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const result = await productApi.updateProduct(selectedProduct.id, productData);
      setShowEditModal(false);
      setSelectedProduct(null);
      resetProductData();
      fetchProducts();
      alert(result.message || 'Product updated successfully!');
    } catch (error) {
      console.error('Error updating product:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProduct = async (productId) => {
    const productToDelete = products.find(p => p.id === productId);
    const productName = productToDelete ? productToDelete.name : 'this product';
    
    if (window.confirm(`Are you sure you want to delete "${productName}"? This action cannot be undone and will remove all related inventory and stock data.`)) {
      setLoading(true);
      try {
        const result = await productApi.deleteProduct(productId);
        await fetchProducts(); // Refresh the product list
        await fetchInventoryOverview(); // Refresh inventory overview
        alert(result.message || 'Product deleted successfully!');
      } catch (error) {
        console.error('Error deleting product:', error);
        
        // Provide more specific error messages
        if (error.message.includes('sales history')) {
          alert('Cannot delete this product because it has sales history. Consider marking it as inactive instead.');
        } else if (error.message.includes('existing references')) {
          alert('Cannot delete this product due to existing references. Please contact support if you need to remove this product.');
        } else {
          alert(`Error deleting product: ${error.message}`);
        }
      } finally {
        setLoading(false);
      }
    }
  };

  const resetProductData = () => {
    setProductData(getInitialProductData());
    setErrors({});
  };

  const openEditModal = (product) => {
    setSelectedProduct(product);
    setProductData({
      name: product.name,
      sku: product.sku,
      price: product.price.toString(),
      cost: product.cost ? product.cost.toString() : '',
      categoryId: product.categoryId,
      description: product.description || '',
      taxRate: product.taxRate ? product.taxRate.toString() : '16',
      isActive: product.isActive,
      // ZRA Compliance fields
      zraClassificationCode: product.zraClassificationCode || '',
      vatCategoryCode: product.vatCategoryCode || 'STANDARD',
      exciseTaxCode: product.exciseTaxCode || '',
      hasExpiry: product.hasExpiry || false,
      shelfLifeDays: product.shelfLifeDays ? product.shelfLifeDays.toString() : '',
      // Inventory fields
      minStockLevel: product.minStockLevel ? product.minStockLevel.toString() : '',
      initialQuantity: '' // Not applicable for edit
    });
    setShowEditModal(true);
  };

  // Utility functions using imported helpers
  const getInventoryInfoForProduct = (productId) => getInventoryInfo(inventory, productId);
  const getStockStatusForProduct = (productId) => getStockStatus(inventory, productId);

  const exportProducts = () => {
    exportProductsToCSV(products, categories, getInventoryInfoForProduct);
  };

  // Enhanced filtering that includes inventory-based filters
  const getFilteredProducts = () => {
    let filtered = filterProducts(products, categories, searchTerm, filterBy);
    
    // Handle inventory-based filters
    if (filterBy === 'low-stock') {
      filtered = filtered.filter(product => {
        const inventoryInfo = getInventoryInfoForProduct(product.id);
        return inventoryInfo.lowStockAlert;
      });
    }
    if (filterBy === 'out-of-stock') {
      filtered = filtered.filter(product => {
        const inventoryInfo = getInventoryInfoForProduct(product.id);
        return inventoryInfo.currentStock === 0;
      });
    }
    
    return filtered;
  };

  const filteredProducts = getFilteredProducts();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Product Catalog</h1>
          <p className="text-gray-600">Manage your product information and pricing</p>
        </div>              <div className="flex gap-2">
                <button 
                  onClick={exportProducts}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  📥 Export
                </button>
                <button className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
                  📤 Import
                </button>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  ➕ Add Product
                </button>
              </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Total Products</p>
                    <p className="text-2xl font-bold text-gray-900">{products.length}</p>
                  </div>
                  <span className="text-2xl">📦</span>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Active Products</p>
                    <p className="text-2xl font-bold text-green-600">
                      {products.filter(p => p.isActive).length}
                    </p>
                  </div>
                  <span className="text-2xl">✅</span>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Categories</p>
                    <p className="text-2xl font-bold text-blue-600">{categories.length}</p>
                  </div>
                  <span className="text-2xl">🏷️</span>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Low Stock Items</p>
                    <p className="text-2xl font-bold text-orange-600">
                      {products.filter(p => getInventoryInfoForProduct(p.id).lowStockAlert).length}
                    </p>
                  </div>
                  <span className="text-2xl">⚠️</span>
                </div>
              </div>
            </div>

            {/* Filters and Search */}
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex flex-col md:flex-row gap-4 items-center">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">🔍</span>
                  <input
                    type="text"
                    placeholder="Search products..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="flex gap-2">
                  <select
                    value={filterBy}
                    onChange={(e) => setFilterBy(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">All Products</option>
                    <option value="active">Active Only</option>
                    <option value="inactive">Inactive Only</option>
                    <option value="low-stock">Low Stock</option>
                    <option value="out-of-stock">Out of Stock</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Products Table */}
            <ProductsTable
              products={filteredProducts}
              categories={categories}
              getInventoryInfo={getInventoryInfoForProduct}
              getStockStatus={getStockStatusForProduct}
              onEdit={openEditModal}
              onDelete={handleDeleteProduct}
              navigateToInventory={navigateToInventory}
            />

            {/* Add Product Modal */}
            <ProductModal
              showModal={showAddModal}
              setShowModal={setShowAddModal}
              isEdit={false}
              productData={productData}
              setProductData={setProductData}
              errors={errors}
              loading={loading}
              onSubmit={handleCreateProduct}
              categories={categories}
              vatCategories={vatCategories}
              getInventoryInfo={getInventoryInfoForProduct}
            />

            {/* Edit Product Modal */}
            <ProductModal
              showModal={showEditModal}
              setShowModal={setShowEditModal}
              isEdit={true}
              productData={productData}
              setProductData={setProductData}
              errors={errors}
              loading={loading}
              onSubmit={handleUpdateProduct}
              categories={categories}
              vatCategories={vatCategories}
              selectedProduct={selectedProduct}
              getInventoryInfo={getInventoryInfoForProduct}
            />
          </div>
        );
      };

      export default ProductsPage;
