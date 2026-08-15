import React, { useState, useEffect } from 'react';
import {
  Download,
  Upload,
  BarChart2,
  Package,
  AlertTriangle,
  TrendingDown,
  Clock,
  TrendingUp,
  Search,
  Plus,
  CheckCircle2,
  X,
} from 'lucide-react';
import StockTakeImportModal from '../components/inventory/StockTakeImportModal';
import { inventoryImportApi } from '../services/inventoryImportService';
import { productApi } from '../services/productService';
import { apiFetch } from '../lib/apiClient';
import StatCard from '../components/ui/StatCard';

const InventoryPage = () => {
  const [showStockTake, setShowStockTake] = useState(false);
  const [ioError, setIoError] = useState('');

  const [inventory, setInventory] = useState([]);
  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBy, setFilterBy] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [adjustmentData, setAdjustmentData] = useState({
    adjustmentType: 'IN',
    quantity: '',
    reason: '',
  });
  const [receiveData, setReceiveData] = useState({
    quantity: '',
    unitCost: '',
    supplierInfo: '',
    batchNumber: '',
    expiryDate: ''
  });
  const [expiryAlerts, setExpiryAlerts] = useState([]);
  const [showExpiryModal, setShowExpiryModal] = useState(false);


  useEffect(() => {
    fetchInventory();
    fetchProductsShared();
    fetchExpiryAlerts();
    // Check if we need to filter by a specific product
    const productFilter = localStorage.getItem('inventoryFilter');
    if (productFilter) {
      setFilterBy('product');
      setSearchTerm(productFilter);
      localStorage.removeItem('inventoryFilter');
    }
  }, []);

  // Use shared productApi for fetching products
  const fetchProductsShared = async () => {
    try {
      const data = await productApi.fetchProducts();
      setProducts(data);
    } catch (error) {
      console.error('[InventoryPage] Error fetching products:', error);
    }
  };

  const fetchInventory = async () => {
    try {
      const data = await apiFetch('/inventory?includeExpired=false');
      setInventory(data.inventory || data);
    } catch (error) {
      console.error('[InventoryPage] Error fetching inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchExpiryAlerts = async () => {
    try {
      const data = await apiFetch('/inventory/expiry-alerts?days=7');
      setExpiryAlerts(data);
    } catch (error) {
      console.error('Error fetching expiry alerts:', error);
    }
  };

  const handleStockAdjustment = async () => {
    try {
      await apiFetch('/inventory/adjust', {
        method: 'POST',
        body: JSON.stringify({
          productId: selectedItem.productId,
          adjustmentType: adjustmentData.adjustmentType,
          quantity: parseInt(adjustmentData.quantity, 10),
          reason: adjustmentData.reason,
        }),
      });
      setShowAdjustModal(false);
      setAdjustmentData({ adjustmentType: 'IN', quantity: '', reason: '' });
      fetchInventory();
    } catch (error) {
      console.error('Error adjusting stock:', error);
      alert(error.message || 'Stock adjustment failed');
    }
  };

  const handleReceiveStock = async () => {
    try {
      await apiFetch('/inventory/receive', {
        method: 'POST',
        body: JSON.stringify({
          productId: selectedItem.productId,
          quantity: parseInt(receiveData.quantity, 10),
          unitCost: parseFloat(receiveData.unitCost),
          supplierInfo: receiveData.supplierInfo,
          batchNumber: receiveData.batchNumber,
          expiryDate: receiveData.expiryDate || null,
        }),
      });
      setShowReceiveModal(false);
      setReceiveData({ quantity: '', unitCost: '', supplierInfo: '', batchNumber: '', expiryDate: '' });
      fetchInventory();
      fetchExpiryAlerts();
    } catch (error) {
      console.error('Error receiving stock:', error);
      alert(error.message || 'Receive stock failed');
    }
  };

  const getStockStatus = (item) => {
    if (item.currentStock === 0) return { label: 'Out of Stock', color: 'bg-red-100 text-red-800' };
    if (item.currentStock <= item.reorderPoint) return { label: 'Low Stock', color: 'bg-yellow-100 text-yellow-800' };
    if (item.currentStock <= item.minimumStock) return { label: 'Warning', color: 'bg-orange-100 text-orange-800' };
    return { label: 'In Stock', color: 'bg-green-100 text-green-800' };
  };

  const getExpiryStatus = (item) => {
    if (!item.expiryAlerts) return null;
    
    const { hasExpiringItems, nearestExpiryDays } = item.expiryAlerts;
    if (!hasExpiringItems) return null;
    
    if (nearestExpiryDays < 0) return { label: 'Expired', color: 'bg-red-100 text-red-800', priority: 4 };
    if (nearestExpiryDays <= 1) return { label: 'Expires Today', color: 'bg-red-100 text-red-800', priority: 3 };
    if (nearestExpiryDays <= 3) return { label: 'Expires Soon', color: 'bg-orange-100 text-orange-800', priority: 2 };
    if (nearestExpiryDays <= 7) return { label: 'Near Expiry', color: 'bg-yellow-100 text-yellow-800', priority: 1 };
    
    return null;
  };

  const markBatchExpired = async (batchId) => {
    try {
      await apiFetch('/inventory/mark-expired', {
        method: 'POST',
        body: JSON.stringify({ batchId, reason: 'Expired' }),
      });
      fetchInventory();
      fetchExpiryAlerts();
    } catch (error) {
      console.error('Error marking batch as expired:', error);
    }
  };

  const filteredInventory = inventory.filter(item => {
    const product = products.find(p => p.id === item.productId);
    const productName = product?.name || '';
    const matchesSearch = productName.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (filterBy === 'low-stock') return matchesSearch && item.currentStock <= item.reorderPoint;
    if (filterBy === 'out-of-stock') return matchesSearch && item.currentStock === 0;
    if (filterBy === 'excess-stock') return matchesSearch && item.currentStock > item.maximumStock;
    if (filterBy === 'expiring') return matchesSearch && item.expiryAlerts?.hasExpiringItems;
    
    return matchesSearch;
  });

  const handleExport = async () => {
    setIoError('');
    try {
      await inventoryImportApi.exportCsv();
    } catch (err) {
      setIoError(err.message || 'Export failed');
    }
  };

  const lowStockCount = inventory.filter(item => item.currentStock <= item.reorderPoint).length;
  const outOfStockCount = inventory.filter(item => item.currentStock === 0).length;
  const expiringItemsCount = inventory.filter(item => item.expiryAlerts?.hasExpiringItems).length;
  const totalValue = inventory.reduce((sum, item) => sum + item.totalValue, 0);

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
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Inventory Management</h1>
          <p className="text-gray-600">Track and manage your stock levels</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleExport} title="Download current stock as a CSV count sheet" className="btn btn-secondary">
            <Download className="w-4 h-4" strokeWidth={1.5} />
            Export
          </button>
          <button onClick={() => setShowStockTake(true)} title="Import a completed stock take" className="btn btn-secondary">
            <Upload className="w-4 h-4" strokeWidth={1.5} />
            Import
          </button>
          <button className="btn btn-secondary">
            <BarChart2 className="w-4 h-4" strokeWidth={1.5} />
            Movements
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard title="Total Items" value={inventory.length} icon={Package} mono />
        <StatCard title="Low Stock Alerts" value={lowStockCount} icon={AlertTriangle} mono tone="text-yellow-600" />
        <StatCard title="Out of Stock" value={outOfStockCount} icon={TrendingDown} mono tone="text-red-600" />
        <StatCard title="Expiring Soon" value={expiringItemsCount} icon={Clock} mono tone="text-orange-600" />
        <StatCard title="Total Value" value={`K${totalValue.toFixed(2)}`} icon={TrendingUp} tone="text-green-600" />
      </div>

      {/* Filters and Search */}
      <div className="panel">
        <div className="panel-body flex flex-col md:flex-row gap-3 items-center">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search products…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-sys pl-8"
            />
          </div>
          <select
            value={filterBy}
            onChange={(e) => setFilterBy(e.target.value)}
            className="input-sys w-auto"
          >
            <option value="all">All Items</option>
            <option value="low-stock">Low Stock</option>
            <option value="out-of-stock">Out of Stock</option>
            <option value="excess-stock">Excess Stock</option>
            <option value="expiring">Expiring Soon</option>
          </select>
          <button onClick={() => setShowExpiryModal(true)} className="btn btn-secondary whitespace-nowrap">
            <Clock className="w-4 h-4" strokeWidth={1.5} />
            Expiry Alerts ({expiryAlerts.length})
          </button>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="panel">
        <div className="panel-header">
          <h3 className="text-sm font-semibold text-gray-900">Inventory Items</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Stock</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Min Stock</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Max Stock</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reorder Point</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expiry</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredInventory.map((item) => {
                const product = products.find(p => p.id === item.productId);
                const status = getStockStatus(item);
                const expiryStatus = getExpiryStatus(item);
                
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="font-medium text-gray-900">{product?.name || 'Unknown Product'}</div>
                        <div className="text-sm text-gray-500">{product?.sku || 'No SKU'}</div>
                        {item.batches && item.batches.length > 0 && (
                          <div className="text-xs text-gray-400">{item.batches.length} batch(es)</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`font-medium ${
                        item.currentStock === 0 ? 'text-red-600' :
                        item.currentStock <= item.reorderPoint ? 'text-yellow-600' :
                        'text-green-600'
                      }`}>
                        {item.currentStock}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-900">{item.minimumStock}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-900">{item.maximumStock}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-900">{item.reorderPoint}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-900">K{item.totalValue.toFixed(2)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${status.color}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {expiryStatus && (
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${expiryStatus.color}`}>
                          {expiryStatus.label}
                        </span>
                      )}
                      {item.expiryAlerts?.nearestExpiryDays !== null && item.expiryAlerts?.nearestExpiryDays >= 0 && (
                        <div className="text-xs text-gray-500 mt-1">
                          {item.expiryAlerts.nearestExpiryDays} days
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setSelectedItem(item);
                            setShowAdjustModal(true);
                          }}
                          className="btn btn-secondary !px-2.5 !py-1 !text-xs"
                        >
                          <Plus className="w-3 h-3" strokeWidth={1.75} />
                          Adjust
                        </button>
                        <button
                          onClick={() => {
                            setSelectedItem(item);
                            setShowReceiveModal(true);
                          }}
                          className="btn btn-secondary !px-2.5 !py-1 !text-xs"
                        >
                          <Package className="w-3 h-3" strokeWidth={1.75} />
                          Receive
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

      {/* Stock Adjustment Modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">Adjust Stock</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="inventorypage-f1">Direction</label>
                <select id="inventorypage-f1"
                  value={adjustmentData.adjustmentType}
                  onChange={(e) =>
                    setAdjustmentData({ ...adjustmentData, adjustmentType: e.target.value })
                  }
                  className="input-sys w-full"
                >
                  <option value="IN">Increase stock</option>
                  <option value="OUT">Decrease stock</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="inventorypage-f2">Quantity</label>
                <input id="inventorypage-f2"
                  type="number"
                  min="1"
                  placeholder="Units"
                  value={adjustmentData.quantity}
                  onChange={(e) =>
                    setAdjustmentData({ ...adjustmentData, quantity: e.target.value })
                  }
                  className="input-sys w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="inventorypage-f3">Reason</label>
                <select id="inventorypage-f3"
                  value={adjustmentData.reason}
                  onChange={(e) => setAdjustmentData({
                    ...adjustmentData,
                    reason: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select reason...</option>
                  <option value="Found Stock">Found Stock</option>
                  <option value="Damaged">Damaged</option>
                  <option value="Expired">Expired</option>
                  <option value="Theft">Theft</option>
                  <option value="Correction">Correction</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setShowAdjustModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleStockAdjustment}
                disabled={!adjustmentData.quantity || !adjustmentData.reason}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Adjust Stock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive Stock Modal */}
      {showReceiveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">Receive Stock</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="inventorypage-f4">Quantity Received</label>
                <input id="inventorypage-f4"
                  type="number"
                  placeholder="Enter quantity"
                  value={receiveData.quantity}
                  onChange={(e) => setReceiveData({
                    ...receiveData,
                    quantity: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="inventorypage-f5">Unit Cost</label>
                <input id="inventorypage-f5"
                  type="number"
                  step="0.01"
                  placeholder="Enter unit cost"
                  value={receiveData.unitCost}
                  onChange={(e) => setReceiveData({
                    ...receiveData,
                    unitCost: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="inventorypage-f6">Supplier Info</label>
                <input id="inventorypage-f6"
                  type="text"
                  placeholder="Supplier name or info"
                  value={receiveData.supplierInfo}
                  onChange={(e) => setReceiveData({
                    ...receiveData,
                    supplierInfo: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="inventorypage-f7">Batch Number (Optional)</label>
                <input id="inventorypage-f7"
                  type="text"
                  placeholder="Batch or lot number"
                  value={receiveData.batchNumber}
                  onChange={(e) => setReceiveData({
                    ...receiveData,
                    batchNumber: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="inventorypage-f8">Expiry Date (Optional)</label>
                <input id="inventorypage-f8"
                  type="date"
                  value={receiveData.expiryDate}
                  onChange={(e) => setReceiveData({
                    ...receiveData,
                    expiryDate: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Leave blank for non-perishable items
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setShowReceiveModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReceiveStock}
                disabled={!receiveData.quantity || !receiveData.unitCost}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Receive Stock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expiry Alerts Modal */}
      {showExpiryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-4xl mx-4 max-h-96 overflow-hidden">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Expiry Alerts</h3>
              <button
                onClick={() => setShowExpiryModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="overflow-y-auto max-h-80">
              {expiryAlerts.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <CheckCircle2 className="w-8 h-8 mx-auto text-green-500" strokeWidth={1.5} />
                  <p className="mt-2">No items expiring in the next 7 days</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {expiryAlerts.map((alert) => (
                    <div key={alert.id} className={`p-4 rounded-lg border-l-4 ${
                      alert.daysUntilExpiry < 0 ? 'border-red-500 bg-red-50' :
                      alert.daysUntilExpiry <= 1 ? 'border-red-400 bg-red-50' :
                      alert.daysUntilExpiry <= 3 ? 'border-orange-400 bg-orange-50' :
                      'border-yellow-400 bg-yellow-50'
                    }`}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{alert.productName}</h4>
                          <p className="text-sm text-gray-600">SKU: {alert.productSku}</p>
                          <p className="text-sm text-gray-600">Batch: {alert.batchNumber}</p>
                          <p className="text-sm text-gray-600">Quantity: {alert.quantity}</p>
                          <p className="text-sm text-gray-600">Value: K{alert.totalValue.toFixed(2)}</p>
                          {alert.supplierInfo && (
                            <p className="text-sm text-gray-600">Supplier: {alert.supplierInfo}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {new Date(alert.expiryDate).toLocaleDateString()}
                          </p>
                          <p className={`text-sm font-semibold ${
                            alert.daysUntilExpiry < 0 ? 'text-red-600' :
                            alert.daysUntilExpiry <= 1 ? 'text-red-500' :
                            alert.daysUntilExpiry <= 3 ? 'text-orange-500' :
                            'text-yellow-600'
                          }`}>
                            {alert.daysUntilExpiry < 0 
                              ? `Expired ${Math.abs(alert.daysUntilExpiry)} days ago`
                              : alert.daysUntilExpiry === 0 
                                ? 'Expires today'
                                : `${alert.daysUntilExpiry} days left`
                            }
                          </p>
                          {alert.daysUntilExpiry <= 0 && (
                            <button
                              onClick={() => markBatchExpired(alert.id)}
                              className="mt-2 px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                            >
                              Mark Expired
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {ioError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {ioError}
        </div>
      )}

      <StockTakeImportModal
        show={showStockTake}
        onClose={() => setShowStockTake(false)}
        onImported={fetchInventory}
      />

    </div>
  );
};

export default InventoryPage;
