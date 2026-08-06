import React, { useState, useEffect, useCallback } from 'react';
import SupplierModal, { EMPTY_SUPPLIER } from '../components/suppliers/SupplierModal';
import SuppliersTable from '../components/suppliers/SuppliersTable';
import SupplierHistoryModal from '../components/suppliers/SupplierHistoryModal';
import { supplierApi } from '../services/supplierService';

const SuppliersPage = () => {
  const [suppliers, setSuppliers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [errors, setErrors] = useState({});
  const [supplierData, setSupplierData] = useState(EMPTY_SUPPLIER);

  const [historyModal, setHistoryModal] = useState({ show: false, supplier: null, data: null, loading: false });

  const fetchSuppliers = useCallback(async (q) => {
    try {
      const data = await supplierApi.fetchSuppliers(q);
      setSuppliers(data);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSuppliers('');
  }, [fetchSuppliers]);

  useEffect(() => {
    const timeout = setTimeout(() => fetchSuppliers(searchTerm), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const validate = () => {
    const newErrors = {};
    if (!supplierData.name?.trim()) newErrors.name = 'Company name is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await supplierApi.createSupplier(supplierData);
      setShowAddModal(false);
      setSupplierData(EMPTY_SUPPLIER);
      fetchSuppliers(searchTerm);
    } catch (error) {
      alert(`Error creating supplier: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await supplierApi.updateSupplier(selectedSupplier.id, supplierData);
      setShowEditModal(false);
      setSelectedSupplier(null);
      setSupplierData(EMPTY_SUPPLIER);
      fetchSuppliers(searchTerm);
    } catch (error) {
      alert(`Error updating supplier: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id) => {
    const supplier = suppliers.find((s) => s.id === id);
    if (!window.confirm(`Deactivate "${supplier?.name}"? You won't be able to raise new POs against them.`)) return;
    try {
      await supplierApi.deactivateSupplier(id);
      fetchSuppliers(searchTerm);
    } catch (error) {
      alert(`Error deactivating supplier: ${error.message}`);
    }
  };

  const openEditModal = (supplier) => {
    setSelectedSupplier(supplier);
    setSupplierData({
      name: supplier.name,
      contactPerson: supplier.contactPerson || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      tpin: supplier.tpin || '',
      address: supplier.address || '',
      notes: supplier.notes || '',
    });
    setErrors({});
    setShowEditModal(true);
  };

  const openHistory = async (supplier) => {
    setHistoryModal({ show: true, supplier, data: null, loading: true });
    try {
      const data = await supplierApi.fetchPurchaseHistory(supplier.id);
      setHistoryModal({ show: true, supplier, data, loading: false });
    } catch (error) {
      alert(`Error loading purchase history: ${error.message}`);
      setHistoryModal({ show: false, supplier: null, data: null, loading: false });
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
          <h1 className="text-3xl font-bold text-gray-900">Suppliers</h1>
          <p className="text-gray-600">Vendor records and purchasing history</p>
        </div>
        <button
          onClick={() => {
            setSupplierData(EMPTY_SUPPLIER);
            setErrors({});
            setShowAddModal(true);
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          + Add Supplier
        </button>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <input
          type="text"
          placeholder="Search by name, phone, or TPIN..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      <SuppliersTable
        suppliers={suppliers}
        onEdit={openEditModal}
        onDeactivate={handleDeactivate}
        onViewHistory={openHistory}
      />

      <SupplierModal
        showModal={showAddModal}
        setShowModal={setShowAddModal}
        isEdit={false}
        supplierData={supplierData}
        setSupplierData={setSupplierData}
        errors={errors}
        loading={saving}
        onSubmit={handleCreate}
      />

      <SupplierModal
        showModal={showEditModal}
        setShowModal={setShowEditModal}
        isEdit={true}
        supplierData={supplierData}
        setSupplierData={setSupplierData}
        errors={errors}
        loading={saving}
        onSubmit={handleUpdate}
      />

      <SupplierHistoryModal
        show={historyModal.show}
        onClose={() => setHistoryModal({ show: false, supplier: null, data: null, loading: false })}
        supplier={historyModal.supplier}
        history={historyModal.data}
        loading={historyModal.loading}
      />
    </div>
  );
};

export default SuppliersPage;
