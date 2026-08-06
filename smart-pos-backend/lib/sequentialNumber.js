/**
 * Shared human-readable sequential number generator (PO-000123 style),
 * mirroring routes/branches.js's generateBhfId() scan-and-increment pattern.
 * Used for PurchaseOrder.poNumber, GoodsReceivedNote.grnNumber, and
 * SupplierReturn.returnNumber — three call sites justify factoring this out
 * instead of repeating the scan loop.
 *
 * No in-transaction retry on collision: a unique-constraint violation inside
 * a Postgres transaction aborts the whole transaction (further statements on
 * the same connection fail until rollback), so "catch and retry" only makes
 * sense as a whole-request retry by the caller, not a query-level retry here
 * — same exposure branches.js's generateBhfId() already has today.
 */

async function nextSequentialNumber(tx, { model, field, prefix, pad = 6 }) {
  const rows = await tx[model].findMany({ select: { [field]: true } });
  const used = new Set(rows.map((r) => r[field]));

  let n = 1;
  while (used.has(`${prefix}-${String(n).padStart(pad, '0')}`)) {
    n += 1;
  }
  return `${prefix}-${String(n).padStart(pad, '0')}`;
}

module.exports = { nextSequentialNumber };
