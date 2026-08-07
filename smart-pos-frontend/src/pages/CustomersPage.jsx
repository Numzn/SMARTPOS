import React, { useState, useEffect, useCallback } from 'react';
import CustomerModal, { EMPTY_CUSTOMER } from '../components/customers/CustomerModal';
import CustomersTable from '../components/customers/CustomersTable';
import { customerApi } from '../services/customerService';

const CustomersPage = () => {
  const [customers, setCustomers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [errors, setErrors] = useState({});
  const [customerData, setCustomerData] = useState(EMPTY_CUSTOMER);

  const fetchCustomers = useCallback(async (q) => {
    try {
      const data = await customerApi.fetchCustomers(q);
      setCustomers(data);
    } catch (error) {
      console.error('Error fetching customers:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers('');
  }, [fetchCustomers]);

  useEffect(() => {
    const timeout = setTimeout(() => fetchCustomers(searchTerm), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const validate = () => {
    const newErrors = {};
    if (!customerData.name?.trim()) newErrors.name = 'Name is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await customerApi.createCustomer(customerData);
      setShowAddModal(false);
      setCustomerData(EMPTY_CUSTOMER);
      fetchCustomers(searchTerm);
    } catch (error) {
      alert(`Error creating customer: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await customerApi.updateCustomer(selectedCustomer.id, customerData);
      setShowEditModal(false);
      setSelectedCustomer(null);
      setCustomerData(EMPTY_CUSTOMER);
      fetchCustomers(searchTerm);
    } catch (error) {
      alert(`Error updating customer: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id) => {
    const customer = customers.find((c) => c.id === id);
    if (!window.confirm(`Deactivate "${customer?.name}"? They will no longer appear in the customer picker.`)) return;
    try {
      await customerApi.deactivateCustomer(id);
      fetchCustomers(searchTerm);
    } catch (error) {
      alert(`Error deactivating customer: ${error.message}`);
    }
  };

  const openEditModal = (customer) => {
    setSelectedCustomer(customer);
    setCustomerData({
      name: customer.name,
      phone: customer.phone || '',
      email: customer.email || '',
      tpin: customer.tpin || '',
      address: customer.address || '',
      notes: customer.notes || '',
    });
    setErrors({});
    setShowEditModal(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-600">Customer records and purchase history</p>
        </div>
        <button
          onClick={() => {
            setCustomerData(EMPTY_CUSTOMER);
            setErrors({});
            setShowAddModal(true);
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          + Add Customer
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

      <CustomersTable customers={customers} onEdit={openEditModal} onDeactivate={handleDeactivate} />

      <CustomerModal
        showModal={showAddModal}
        setShowModal={setShowAddModal}
        isEdit={false}
        customerData={customerData}
        setCustomerData={setCustomerData}
        errors={errors}
        loading={saving}
        onSubmit={handleCreate}
      />

      <CustomerModal
        showModal={showEditModal}
        setShowModal={setShowEditModal}
        isEdit={true}
        customerData={customerData}
        setCustomerData={setCustomerData}
        errors={errors}
        loading={saving}
        onSubmit={handleUpdate}
      />
    </div>
  );
};

export default CustomersPage;
