import React, { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import ProductPicker from './ProductPicker';
import { fetchComposition, addCompositionComponent, removeCompositionComponent } from '../../api/itemCompositionApi';

const STATUS_STYLES = {
  REGISTERED: 'bg-green-100 text-green-800',
  PENDING: 'bg-yellow-100 text-yellow-800',
  FAILED: 'bg-red-100 text-red-800',
};

/**
 * VSDC Item Composition (Section 6.5, item 9* — OPTIONAL per spec, see
 * smart-pos-backend/docs/zra-self-checklist.md). Manages "what is this
 * product made of" — a bill-of-materials line per component.
 *
 * No update/delete endpoint exists in the real spec (only "save"), so
 * removal here is local-only — that's a real, documented gap, not an
 * oversight, and is surfaced to the user via the note under the list.
 */
export default function ItemCompositionModal({ open, onClose, product }) {
  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [pickedComponent, setPickedComponent] = useState(null);
  const [quantity, setQuantity] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [removingId, setRemovingId] = useState(null);

  const load = () => {
    if (!product?.id) return;
    setLoading(true);
    setLoadError(null);
    fetchComposition(product.id)
      .then((res) => setComponents(res?.components || []))
      .catch((err) => setLoadError(err?.message || 'Failed to load composition'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) {
      load();
      setPickedComponent(null);
      setQuantity('');
      setSaveError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  const handleAdd = async () => {
    if (!pickedComponent) {
      setSaveError('Pick a component product first');
      return;
    }
    const numericQuantity = parseFloat(quantity);
    if (!(numericQuantity > 0)) {
      setSaveError('Quantity must be greater than 0');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await addCompositionComponent(product.id, {
        componentProductId: pickedComponent.id,
        quantity: numericQuantity,
      });
      setPickedComponent(null);
      setQuantity('');
      load();
    } catch (err) {
      setSaveError(err?.message || 'Failed to save component');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (compositionId) => {
    setRemovingId(compositionId);
    try {
      await removeCompositionComponent(product.id, compositionId);
      setComponents((prev) => prev.filter((c) => c.id !== compositionId));
    } catch (err) {
      setSaveError(err?.message || 'Failed to remove component');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? `Composition — ${product.name}` : 'Composition'}
      description="What this product is made of, registered with ZRA via /items/saveItemComposition."
      size="lg"
    >
      <div className="space-y-4">
        <div>
          <h4 className="font-medium text-gray-900 mb-2">Add a component</h4>
          <div className="flex gap-2 items-start">
            <div className="flex-1">
              {pickedComponent ? (
                <div className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 flex items-center justify-between">
                  <span className="text-sm">
                    {pickedComponent.name}
                    {pickedComponent.sku && (
                      <span className="ml-2 font-mono text-xs text-gray-500">{pickedComponent.sku}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPickedComponent(null)}
                    className="ml-2 text-gray-400 hover:text-gray-600"
                    aria-label="Clear picked component"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <ProductPicker excludeProductId={product?.id} onSelect={setPickedComponent} />
              )}
            </div>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="Qty"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
          {saveError && <p className="text-red-500 text-xs mt-1">{saveError}</p>}
        </div>

        <div>
          <h4 className="font-medium text-gray-900 mb-2 border-t pt-3">Current components</h4>
          {loading && <p className="text-sm text-gray-500">Loading…</p>}
          {!loading && loadError && <p className="text-sm text-red-600">{loadError}</p>}
          {!loading && !loadError && components.length === 0 && (
            <p className="text-sm text-gray-500">No components added yet.</p>
          )}
          {!loading && !loadError && components.length > 0 && (
            <ul className="divide-y divide-gray-200 border border-gray-200 rounded-md">
              {components.map((c) => (
                <li key={c.id} className="flex items-center justify-between px-3 py-2">
                  <div className="min-w-0">
                    <span className="text-sm text-gray-900">{c.componentProduct.name}</span>
                    {c.componentProduct.sku && (
                      <span className="ml-2 font-mono text-xs text-gray-500">{c.componentProduct.sku}</span>
                    )}
                    <span className="ml-2 text-sm text-gray-600">× {c.quantity}</span>
                    <span
                      className={`ml-2 inline-block px-2 py-0.5 rounded text-xs ${
                        STATUS_STYLES[c.zraRegistrationStatus] || 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {c.zraRegistrationStatus}
                    </span>
                    {c.zraRegistrationError && (
                      <span className="block text-xs text-red-600 mt-0.5">{c.zraRegistrationError}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(c.id)}
                    disabled={removingId === c.id}
                    className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    {removingId === c.id ? 'Removing…' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-500 mt-2">
            Removing a component only updates SmartPOS — ZRA's API has no delete/update for item
            composition, only "save", so a removal here is not reported to ZRA.
          </p>
        </div>
      </div>
    </Modal>
  );
}
