import React from 'react';

const EMPTY_RETURN = { supplierId: '', reason: '', items: [] };

const emptyLine = () => ({ productId: '', quantity: 1, unitCost: '' });

const SupplierReturnModal = ({
  showModal,
  setShowModal,
  returnData,
  setReturnData,
  errors,
  loading,
  onSubmit,
  suppliers,
  products,
}) => {
  if (!showModal) return null;

  const handleClose = () => {
    setShowModal(false);
    setReturnData(EMPTY_RETURN);
  };

  const updateLine = (index, patch) => {
    const items = returnData.items.map((line, i) => (i === index ? { ...line, ...patch } : line));
    setReturnData({ ...returnData, items });
  };

  const addLine = () => {
    setReturnData({ ...returnData, items: [...returnData.items, emptyLine()] });
  };

  const removeLine = (index) => {
    setReturnData({ ...returnData, items: returnData.items.filter((_, i) => i !== index) });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">Return Stock to Supplier</h3>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Supplier *</label>
          <select
            value={returnData.supplierId}
            onChange={(e) => setReturnData({ ...returnData, supplierId: e.target.value })}
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

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Reason</label>
          <textarea
            value={returnData.reason || ''}
            onChange={(e) => setReturnData({ ...returnData, reason: e.target.value })}
            rows={2}
            placeholder="e.g. Damaged on arrival, wrong item shipped..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h4 className="font-medium text-gray-700">Items to Return</h4>
          <button
            type="button"
            onClick={addLine}
            className="text-sm px-3 py-1 border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50"
          >
            + Add Item
          </button>
        </div>
        {errors?.items && <p className="text-red-500 text-xs mb-2">{errors.items}</p>}

        {returnData.items.length === 0 ? (
          <p className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-md p-4 text-center">
            No items yet. Add at least one product to return.
          </p>
        ) : (
          <div className="border border-gray-200 rounded-md overflow-hidden mb-6">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 w-24">Qty</th>
                  <th className="px-3 py-2 w-32">Unit Cost</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {returnData.items.map((line, index) => (
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
                        placeholder="avg. cost"
                        value={line.unitCost}
                        onChange={(e) => updateLine(index, { unitCost: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md"
                      />
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

        <div className="flex justify-end gap-2">
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
            {loading ? 'Saving...' : 'Record Return'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SupplierReturnModal;
export { EMPTY_RETURN };
