/**
 * The transaction engine's fold step — pure function, no I/O. Cart state is
 * always *derived* from the ordered scan journal, never mutated ad hoc. This
 * is what makes "A -> B -> C -> ... stays ordered" provable: the same
 * ordered input always folds to the same cart, regardless of timing.
 *
 * Entries in CAPTURED (still being resolved) contribute nothing yet.
 * RESOLVED/SYNCING/SYNCED all count toward cart quantity — sync status is a
 * background-reconciliation concern, not a reason to hide an item the
 * cashier already saw scanned. LOOKUP_FAILED/SYNC_REJECTED never count, and
 * are surfaced separately so they can't be silently dropped.
 */

const COUNTS_TOWARD_CART = new Set(['RESOLVED', 'SYNCING', 'SYNCED']);
const NEEDS_ATTENTION = new Set(['LOOKUP_FAILED', 'SYNC_REJECTED']);

export function foldScanEntriesToCart(entries, productsById) {
  const lines = new Map();
  for (const entry of entries) {
    if (!COUNTS_TOWARD_CART.has(entry.status)) continue;
    const product = productsById.get(entry.productId);
    if (!product) continue; // product removed from catalog mid-session — see §5 staleness note
    const existing = lines.get(entry.productId);
    if (existing) {
      existing.quantity += 1;
    } else {
      lines.set(entry.productId, { ...product, quantity: 1 });
    }
  }
  return Array.from(lines.values());
}

export function unresolvedEntries(entries) {
  return entries.filter((e) => NEEDS_ATTENTION.has(e.status));
}
