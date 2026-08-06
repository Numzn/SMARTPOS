import React, { useState, useEffect, useCallback } from 'react';
import PurchaseOrderModal, { EMPTY_PO } from '../components/purchasing/PurchaseOrderModal';
import PurchaseOrdersTable from '../components/purchasing/PurchaseOrdersTable';
import PurchaseOrderDetailModal from '../components/purchasing/PurchaseOrderDetailModal';
import ReceiveAgainstPoModal from '../components/purchasing/ReceiveAgainstPoModal';
import GoodsReceivedNotesTable from '../components/purchasing/GoodsReceivedNotesTable';
import SupplierReturnModal, { EMPTY_RETURN } from '../components/purchasing/SupplierReturnModal';
import SupplierReturnsTable from '../components/purchasing/SupplierReturnsTable';
import { purchaseOrderApi, grnApi, supplierReturnApi } from '../services/purchasingService';
import { supplierApi } from '../services/supplierService';
import { productApi } from '../services/productService';

const TABS = [
  { key: 'orders', label: 'Purchase Orders' },
  { key: 'grns', label: 'Goods Received' },
  { key: 'returns', label: 'Supplier Returns' },
];

const PurchaseOrdersPage = () => {
  const [activeTab, setActiveTab] = useState('orders');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);

  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [goodsReceivedNotes, setGoodsReceivedNotes] = useState([]);
  const [supplierReturns, setSupplierReturns] = useState([]);

  const [showPoModal, setShowPoModal] = useState(false);
  const [isEditPo, setIsEditPo] = useState(false);
  const [poData, setPoData] = useState(EMPTY_PO);
  const [poErrors, setPoErrors] = useState({});

  const [detailPo, setDetailPo] = useState(null);
  const [receivePo, setReceivePo] = useState(null);

  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnData, setReturnData] = useState(EMPTY_RETURN);
  const [returnErrors, setReturnErrors] = useState({});

  const loadAll = useCallback(async () => {
    try {
      const [supplierList, productList, poList, grnList, returnList] = await Promise.all([
        supplierApi.fetchSuppliers(),
        productApi.fetchProducts(),
        purchaseOrderApi.fetchPurchaseOrders(),
        grnApi.fetchGrns(),
        supplierReturnApi.fetchReturns(),
      ]);
      setSuppliers(supplierList);
      setProducts(productList);
      setPurchaseOrders(poList);
      setGoodsReceivedNotes(grnList);
      setSupplierReturns(returnList);
    } catch (error) {
      console.error('Error loading purchasing data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const refreshOrders = async () => {
    const poList = await purchaseOrderApi.fetchPurchaseOrders();
    setPurchaseOrders(poList);
    return poList;
  };

  const refreshGrns = async () => {
    setGoodsReceivedNotes(await grnApi.fetchGrns());
  };

  const refreshReturns = async () => {
    setSupplierReturns(await supplierReturnApi.fetchReturns());
  };

  const validatePo = () => {
    const errors = {};
    if (!poData.supplierId) errors.supplierId = 'Supplier is required';
    if (!poData.items.length || poData.items.some((line) => !line.productId || !Number(line.quantity))) {
      errors.items = 'Every line needs a product and a quantity greater than zero';
    }
    setPoErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreatePo = async () => {
    if (!validatePo()) return;
    setSaving(true);
    try {
      await purchaseOrderApi.createPurchaseOrder(poData);
      setShowPoModal(false);
      setPoData(EMPTY_PO);
      await refreshOrders();
    } catch (error) {
      alert(`Error creating purchase order: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePo = async () => {
    if (!validatePo()) return;
    setSaving(true);
    try {
      await purchaseOrderApi.updatePurchaseOrder(detailPo.id, poData);
      setShowPoModal(false);
      setPoData(EMPTY_PO);
      const poList = await refreshOrders();
      setDetailPo(poList.find((po) => po.id === detailPo.id) || null);
    } catch (error) {
      alert(`Error updating purchase order: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const openCreatePo = () => {
    setIsEditPo(false);
    setPoData(EMPTY_PO);
    setPoErrors({});
    setShowPoModal(true);
  };

  const openEditPo = (po) => {
    setIsEditPo(true);
    setPoData({
      supplierId: po.supplierId,
      expectedDate: po.expectedDate ? po.expectedDate.slice(0, 10) : '',
      notes: po.notes || '',
      items: po.items.map((item) => ({ productId: item.productId, quantity: item.quantityOrdered, unitCost: item.unitCost })),
    });
    setPoErrors({});
    setDetailPo(null);
    setShowPoModal(true);
  };

  const openDetail = async (po) => {
    const full = await purchaseOrderApi.fetchPurchaseOrder(po.id);
    setDetailPo(full);
  };

  const handleSend = async (po) => {
    setActionLoading(true);
    try {
      const updated = await purchaseOrderApi.sendPurchaseOrder(po.id);
      setDetailPo(updated.purchaseOrder || updated);
      await refreshOrders();
    } catch (error) {
      alert(`Error sending purchase order: ${error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async (po) => {
    if (!window.confirm(`Cancel purchase order ${po.poNumber}?`)) return;
    setActionLoading(true);
    try {
      const updated = await purchaseOrderApi.cancelPurchaseOrder(po.id);
      setDetailPo(updated.purchaseOrder || updated);
      await refreshOrders();
    } catch (error) {
      alert(`Error cancelling purchase order: ${error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReceiveSubmit = async (items) => {
    if (!items.length) {
      alert('Enter a quantity greater than zero for at least one line.');
      return;
    }
    setActionLoading(true);
    try {
      await purchaseOrderApi.receiveAgainstPurchaseOrder(receivePo.id, { items });
      setReceivePo(null);
      setDetailPo(null);
      await refreshOrders();
      await refreshGrns();
    } catch (error) {
      alert(`Error receiving stock: ${error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const validateReturn = () => {
    const errors = {};
    if (!returnData.supplierId) errors.supplierId = 'Supplier is required';
    if (!returnData.items.length || returnData.items.some((line) => !line.productId || !Number(line.quantity))) {
      errors.items = 'Every line needs a product and a quantity greater than zero';
    }
    setReturnErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateReturn = async () => {
    if (!validateReturn()) return;
    setSaving(true);
    try {
      const payload = {
        ...returnData,
        items: returnData.items.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          ...(line.unitCost !== '' && line.unitCost != null ? { unitCost: line.unitCost } : {}),
        })),
      };
      await supplierReturnApi.createReturn(payload);
      setShowReturnModal(false);
      setReturnData(EMPTY_RETURN);
      await refreshReturns();
    } catch (error) {
      alert(`Error recording supplier return: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Purchasing</h1>
          <p className="text-gray-600">Purchase orders, deliveries, and supplier returns</p>
        </div>
        {activeTab === 'orders' && (
          <button
            onClick={openCreatePo}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            + New Purchase Order
          </button>
        )}
        {activeTab === 'returns' && (
          <button
            onClick={() => {
              setReturnData(EMPTY_RETURN);
              setReturnErrors({});
              setShowReturnModal(true);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            + New Supplier Return
          </button>
        )}
      </div>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`py-3 px-1 border-b-2 text-sm font-medium ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'orders' && <PurchaseOrdersTable purchaseOrders={purchaseOrders} onView={openDetail} />}
      {activeTab === 'grns' && <GoodsReceivedNotesTable goodsReceivedNotes={goodsReceivedNotes} />}
      {activeTab === 'returns' && <SupplierReturnsTable supplierReturns={supplierReturns} />}

      <PurchaseOrderModal
        showModal={showPoModal}
        setShowModal={setShowPoModal}
        isEdit={isEditPo}
        poData={poData}
        setPoData={setPoData}
        errors={poErrors}
        loading={saving}
        onSubmit={isEditPo ? handleUpdatePo : handleCreatePo}
        suppliers={suppliers}
        products={products}
      />

      <PurchaseOrderDetailModal
        show={!!detailPo}
        onClose={() => setDetailPo(null)}
        po={detailPo}
        actionLoading={actionLoading}
        onEdit={openEditPo}
        onSend={handleSend}
        onCancel={handleCancel}
        onReceive={(po) => setReceivePo(po)}
      />

      <ReceiveAgainstPoModal
        show={!!receivePo}
        onClose={() => setReceivePo(null)}
        po={receivePo}
        loading={actionLoading}
        onSubmit={handleReceiveSubmit}
      />

      <SupplierReturnModal
        showModal={showReturnModal}
        setShowModal={setShowReturnModal}
        returnData={returnData}
        setReturnData={setReturnData}
        errors={returnErrors}
        loading={saving}
        onSubmit={handleCreateReturn}
        suppliers={suppliers}
        products={products}
      />
    </div>
  );
};

export default PurchaseOrdersPage;
