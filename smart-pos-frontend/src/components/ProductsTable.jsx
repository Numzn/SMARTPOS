import React from 'react';
import { getRegistrationStatusBadge } from '../utils/productUtils';

const ProductsTable = ({ 
  products, 
  categories, 
  getInventoryInfo, 
  getStockStatus, 
  onEdit, 
  onDelete, 
  navigateToInventory 
}) => {
  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-medium text-gray-900">Product List</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ZRA Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {products.map((product) => {
              const category = categories.find(cat => cat.id === product.categoryId);
              const inventoryInfo = getInventoryInfo(product.id);
              const stockStatus = getStockStatus(product.id);
              
              return (
                <tr key={product.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="font-medium text-gray-900">{product.name}</div>
                      <div className="text-sm text-gray-500">{product.description}</div>
                      {product.hasExpiry && (
                        <div className="text-xs text-orange-600">⏰ Expires in {product.shelfLifeDays} days</div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-900">{product.sku}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-gray-900 font-medium">K{product.price.toFixed(2)}</div>
                      {product.cost && (
                        <div className="text-sm text-gray-500">Cost: K{product.cost.toFixed(2)}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-900">
                    {category?.name || 'Unknown'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${
                        inventoryInfo.currentStock === 0 ? 'text-red-600' :
                        inventoryInfo.lowStockAlert ? 'text-yellow-600' :
                        'text-green-600'
                      }`}>
                        {inventoryInfo.currentStock}
                      </span>
                      <button
                        onClick={() => navigateToInventory(product.id, product.name)}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        📊 View
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-xs space-y-1">
                      {(() => {
                        const reg = getRegistrationStatusBadge(product.zraRegistrationStatus);
                        return (
                          <div className={`inline-flex px-2 py-1 rounded-full ${reg.className}`}>
                            {reg.label}
                          </div>
                        );
                      })()}
                      <div className="text-gray-500">
                        VAT: {product.vatCategoryCode || 'STANDARD'}
                      </div>
                      {product.zraClassificationCode && (
                        <div className="text-gray-500">Class: {product.zraClassificationCode}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="space-y-1">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        product.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {product.isActive ? 'Active' : 'Inactive'}
                      </span>
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${stockStatus.color}`}>
                        {stockStatus.label}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex gap-2">
                      <button
                        onClick={() => onEdit(product)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => onDelete(product.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs"
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ProductsTable;
