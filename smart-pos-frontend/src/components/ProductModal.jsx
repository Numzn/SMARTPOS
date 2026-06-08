import React from 'react';

const ProductModal = ({ 
  showModal, 
  setShowModal, 
  isEdit = false, 
  productData, 
  setProductData, 
  errors, 
  loading, 
  onSubmit, 
  categories, 
  vatCategories,
  selectedProduct,
  getInventoryInfo 
}) => {
  if (!showModal) return null;

  const resetProductData = () => {
    setProductData({
      name: '',
      sku: '',
      price: '',
      cost: '',
      categoryId: '',
      description: '',
      taxRate: '16',
      isActive: true,
      // ZRA Compliance fields
      zraClassificationCode: '',
      vatCategoryCode: 'STANDARD',
      exciseTaxCode: '',
      hasExpiry: false,
      shelfLifeDays: '',
      // Inventory fields
      minStockLevel: '',
      initialQuantity: ''
    });
  };

  const handleClose = () => {
    setShowModal(false);
    resetProductData();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">
          {isEdit ? 'Edit Product' : 'Add New Product'}
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Basic Information */}
          <div className="md:col-span-2">
            <h4 className="font-medium text-gray-900 mb-2 border-b pb-2">📋 Basic Information</h4>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Product Name *</label>
            <input
              type="text"
              placeholder="Enter product name"
              value={productData.name}
              onChange={(e) => setProductData({ ...productData, name: e.target.value })}
              className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors.name ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">SKU *</label>
            <input
              type="text"
              placeholder="Enter SKU"
              value={productData.sku}
              onChange={(e) => setProductData({ ...productData, sku: e.target.value })}
              className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors.sku ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {errors.sku && <p className="text-red-500 text-xs mt-1">{errors.sku}</p>}
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Selling Price (K) *</label>
            <input
              type="number"
              step="0.01"
              placeholder="Enter price"
              value={productData.price}
              onChange={(e) => setProductData({ ...productData, price: e.target.value })}
              className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors.price ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {errors.price && <p className="text-red-500 text-xs mt-1">{errors.price}</p>}
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Cost Price (K)</label>
            <input
              type="number"
              step="0.01"
              placeholder="Enter cost"
              value={productData.cost}
              onChange={(e) => setProductData({ ...productData, cost: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Category *</label>
            <select
              value={productData.categoryId}
              onChange={(e) => setProductData({ ...productData, categoryId: e.target.value })}
              className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors.categoryId ? 'border-red-500' : 'border-gray-300'
              }`}
            >
              <option value="">
                {categories.length === 0 ? 'Loading categories...' : 'Select category...'}
              </option>
              {categories.map(category => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            {errors.categoryId && <p className="text-red-500 text-xs mt-1">{errors.categoryId}</p>}
            {categories.length === 0 && (
              <p className="text-sm text-gray-500 mt-1">
                📝 Categories will be created automatically when you open this form.
              </p>
            )}
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Tax Rate (%)</label>
            <input
              type="number"
              step="0.01"
              value={productData.taxRate}
              onChange={(e) => setProductData({ ...productData, taxRate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              placeholder="Enter product description"
              value={productData.description}
              onChange={(e) => setProductData({ ...productData, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows="2"
            />
          </div>

          {/* ZRA Compliance Section */}
          <div className="md:col-span-2">
            <h4 className="font-medium text-gray-900 mb-2 border-b pb-2">🇿🇲 ZRA Compliance</h4>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">VAT Category</label>
            <select
              value={productData.vatCategoryCode}
              onChange={(e) => setProductData({ ...productData, vatCategoryCode: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {vatCategories.map(category => (
                <option key={category.value} value={category.value}>{category.label}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">ZRA Classification Code</label>
            <input
              type="text"
              placeholder="Enter ZRA classification code"
              value={productData.zraClassificationCode}
              onChange={(e) => setProductData({ ...productData, zraClassificationCode: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Excise Tax Code</label>
            <input
              type="text"
              placeholder="Enter excise tax code (if applicable)"
              value={productData.exciseTaxCode}
              onChange={(e) => setProductData({ ...productData, exciseTaxCode: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Expiry Tracking */}
          <div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={productData.hasExpiry}
                onChange={(e) => setProductData({ ...productData, hasExpiry: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
              />
              <span className="ml-2 text-sm text-gray-600">Product has expiry date</span>
            </label>
          </div>

          {productData.hasExpiry && (
            <div>
              <label className="block text-sm font-medium mb-1">Shelf Life (Days) *</label>
              <input
                type="number"
                placeholder="Enter shelf life in days"
                value={productData.shelfLifeDays}
                onChange={(e) => setProductData({ ...productData, shelfLifeDays: e.target.value })}
                className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  errors.shelfLifeDays ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {errors.shelfLifeDays && <p className="text-red-500 text-xs mt-1">{errors.shelfLifeDays}</p>}
            </div>
          )}

          {/* Inventory Settings - Only show for Add mode */}
          {!isEdit && (
            <>
              <div className="md:col-span-2">
                <h4 className="font-medium text-gray-900 mb-2 border-b pb-2">📦 Initial Stock (Optional)</h4>
                <p className="text-sm text-gray-600 mb-2">You can add initial stock now or manage inventory separately.</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Initial Quantity</label>
                <input
                  type="number"
                  placeholder="Enter initial stock quantity"
                  value={productData.initialQuantity || ''}
                  onChange={(e) => setProductData({ ...productData, initialQuantity: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Minimum Stock Level</label>
                <input
                  type="number"
                  placeholder="Enter minimum stock alert level"
                  value={productData.minStockLevel || ''}
                  onChange={(e) => setProductData({ ...productData, minStockLevel: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </>
          )}

          {/* Current Inventory Status - Only show for Edit mode */}
          {isEdit && selectedProduct && (
            <div className="md:col-span-2">
              <h4 className="font-medium text-gray-900 mb-2 border-b pb-2">📦 Current Inventory Status</h4>
              <div className="bg-gray-50 p-3 rounded-md">
                <p className="text-sm text-gray-600">
                  Current Stock: <span className="font-medium">{getInventoryInfo(selectedProduct.id).currentStock || 0}</span> units
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  To modify inventory levels, use the <strong>Inventory Management</strong> page.
                </p>
              </div>
            </div>
          )}

          <div className="md:col-span-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={productData.isActive}
                onChange={(e) => setProductData({ ...productData, isActive: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
              />
              <span className="ml-2 text-sm text-gray-600">Product is active</span>
            </label>
          </div>
        </div>

        {/* Display validation errors */}
        {Object.keys(errors).length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 mt-4">
            <h4 className="text-red-800 font-medium text-sm">Please fix the following errors:</h4>
            <ul className="list-disc list-inside text-red-700 text-sm mt-1">
              {Object.values(errors).map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? (isEdit ? 'Updating...' : 'Creating...') : (isEdit ? 'Update Product' : 'Create Product')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductModal;
