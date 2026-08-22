/**
 * The local product lookup layer — a barcode/SKU-indexed Map built from the
 * same full-catalog fetch CashierDashboard already does today
 * (GET /api/products). Not a partial cache: since the whole catalog is
 * already loaded client-side, a miss here means "not a registered product,"
 * not "stale cache" — there is no separate network fallback lookup, because
 * there is nothing a per-scan network call could find that this index
 * doesn't already have. Freshness comes entirely from re-running this over
 * whatever CashierDashboard's periodic silent refresh produces next.
 */

export function buildBarcodeIndex(products) {
  const map = new Map();
  for (const product of products || []) {
    if (product.barcode) map.set(String(product.barcode), product);
    if (product.sku) map.set(String(product.sku), product);
  }
  return map;
}

/** Trim only — barcodes are compared exactly, no vendor-specific reformatting. */
export function normalizeBarcode(rawToken) {
  return String(rawToken || '').trim();
}
