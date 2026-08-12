import { apiFetch } from '../lib/apiClient';

/**
 * VSDC Item Composition (Section 6.5, item 9* — OPTIONAL per spec).
 * Sub-resource of a product: /api/products/:id/composition.
 */
export async function fetchComposition(productId) {
  return apiFetch(`/products/${productId}/composition`);
}

export async function addCompositionComponent(productId, { componentProductId, quantity }) {
  return apiFetch(`/products/${productId}/composition`, {
    method: 'POST',
    body: JSON.stringify({ componentProductId, quantity }),
  });
}

export async function removeCompositionComponent(productId, compositionId) {
  return apiFetch(`/products/${productId}/composition/${compositionId}`, {
    method: 'DELETE',
  });
}
