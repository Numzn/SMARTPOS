import React from 'react';
import Modal from '../ui/Modal';

const EMPTY_PO = { supplierId: '', expectedDate: '', notes: '', items: [] };

const emptyLine = () => ({ productId: '', quantity: 1, unitCost: 0 });

const PurchaseOrderModal = ({
  showModal,
  setShowModal,
  isEdit,
  poData,
  setPoData,
  errors,
  loading,
  onSubmit,
  suppliers,
  products,
}) => {
  const handleClose = () => {
    setShowModal(false);
    setPoData(EMPTY_PO);
  };

  const updateLine = (index, patch) => {
    const items = poData.items.map((line, i) => (i === index ? { ...line, ...patch } : line));
    setPoData({ ...poData, items });
  };

  const addLine = () => {
    setPoData({ ...poData, items: [...poData.items, emptyLine()] });
  };

  const removeLine = (index) => {
    setPoData({ ...poData, items: poData.items.filter((_, i) => i !== index) });
  };

  const total = poData.items.reduce(
    (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0),
    0
  );

  const footerActions = (
    <>
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Draft'}
          </button>
    </>
  );

  return (
    <Modal
      open={showModal}
      onClose={handleClose}
      title={isEdit ? 'Edit Draft Purchase Order' : 'New Purchase Order'}
      size="xl"
      footer={footerActions}
    >

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="purchaseordermodal-f1">Supplier *</label>
            <select id="purchaseordermodal-f1"
              value={poData.supplierId}
              onChange={(e) => setPoData({ ...poData, supplierId: e.target.value })}
              className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors?.supplierId ? 'border-red-500' : 'border-gray-300'
              }`}
            >
              <option value="">Select a supplier...</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {errors?.supplierId && <p className="text-red-500 text-xs mt-1">{errors.supplierId}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="purchaseordermodal-f2">Expected Date</label>
            <input id="purchaseordermodal-f2"
              type="date"
              value={poData.expectedDate || ''}
              onChange={(e) => setPoData({ ...poData, expectedDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1" htmlFor="purchaseordermodal-f3">Notes</label>
          <textarea id="purchaseordermodal-f3"
            value={poData.notes || ''}
            onChange={(e) => setPoData({ ...poData, notes: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h4 className="font-medium text-gray-700">Line Items</h4>
          <button
            type="button"
            onClick={addLine}
            className="text-sm px-3 py-1 border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50"
          >
            + Add Item
          </button>
        </div>
        {errors?.items && <p className="text-red-500 text-xs mb-2">{errors.items}</p>}

        {poData.items.length === 0 ? (
          <p className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-md p-4 text-center">
            No items yet. Add at least one product.
          </p>
        ) : (
          <div className="border border-gray-200 rounded-md overflow-hidden mb-2">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 w-24">Qty</th>
                  <th className="px-3 py-2 w-32">Unit Cost</th>
                  <th className="px-3 py-2 w-28 text-right">Line Total</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {poData.items.map((line, index) => (
                  <tr key={index}>
                    <td className="px-3 py-2">
                      <select
                        value={line.productId}
                        onChange={(e) => updateLine(index, { productId: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md"
                      >
                        <option value="">Select product...</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={(e) => updateLine(index, { quantity: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitCost}
                        onChange={(e) => updateLine(index, { unitCost: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md"
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      K{((Number(line.quantity) || 0) * (Number(line.unitCost) || 0)).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(index)}
                        className="text-red-500 hover:text-red-700"
                        aria-label="Remove item"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="text-right text-sm font-medium text-gray-800 mb-6">Total: K{total.toFixed(2)}</div>

    </Modal>
  );
};

export default PurchaseOrderModal;
export { EMPTY_PO };
