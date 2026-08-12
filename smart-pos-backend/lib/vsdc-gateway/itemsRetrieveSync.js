/**
 * Item 10* — POST /items/selectItems (VSDC API Spec v1.0.8), "GET ITEMS".
 * Confirmed OPTIONAL per spec text (same category as item 28*'s
 * /stock/selectStockItems). Not to be confused with the adjacent singular
 * /items/selectItem (lookup by itemCd, no lastReqDt) — a different
 * endpoint, out of scope here.
 *
 * Unlike item 28*, the spec has a confirmed JSON response sample for this
 * endpoint (data.itemList[]), so extractItemRecords() expects that shape
 * directly rather than defensively guessing among several candidates.
 *
 * This is a reconciliation SNAPSHOT of what ZRA has on file per item, not
 * an append-only movement log — the response carries no per-record
 * identifier equivalent to sarNo; it's an item master list, one row per
 * itemCd. Idempotency is therefore structural, not dedup-based: each
 * retrieved item is written into Product.zraItemSnapshot (matched by
 * itemCd === Product.sku), overwritten on every sync. Re-processing the
 * same item any number of times — including on a post-failure retry —
 * produces the same end state, not a duplicate row. Operational Product
 * fields (name, price, barcode, etc.) are never touched here, mirroring
 * Branch.zraBranchSnapshot's existing "reference, not authority" pattern.
 * Unmatched itemCd values are reported, never fabricated into a new
 * Product row (same reasoning as item 28*'s unmatched-itemCd handling).
 *
 * Cursor: ItemRetrievalCursor, structurally identical to
 * StockRetrievalCursor, kept as its own model rather than a shared one —
 * see zra-self-checklist.md item 10*'s row for the reasoning.
 */
const prisma = require('../prisma');
const transport = require('./transport');
const endpointAdapter = require('./endpointAdapter');

function vsdcCtx() {
  const vsdcService = require('../../services/vsdcService');
  return { tpin: vsdcService.tpin, bhfId: vsdcService.bhfId };
}

// Spec's own stated default for lastReqDt — confirmed identical text
// ("defaults to 20160523000000") to item 28*'s /stock/selectStockItems
// default. Duplicated here rather than imported from stockRetrieveSync.js
// deliberately, to avoid touching a shipped, live-verified module for a
// 1-constant/4-line DRY win.
const SPEC_DEFAULT_LAST_REQ_DT = '20160523000000';

function formatVsdcDateTime(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// The spec confirms this endpoint's response shape with an actual JSON
// sample (data.itemList[]) — unlike item 28*'s extractStockRecords(), this
// throws on anything else rather than guessing among several shapes.
function extractItemRecords(responseData) {
  const data = responseData?.data ?? responseData;
  if (!Array.isArray(data?.itemList)) {
    throw new Error(
      'Unrecognized /items/selectItems response shape — expected data.itemList to be an array'
    );
  }
  return data.itemList;
}

async function fetchItems(lastReqDt) {
  const ctx = vsdcCtx();
  const path = endpointAdapter.path('itemsSelect');
  const body = { tpin: ctx.tpin, bhfId: ctx.bhfId, lastReqDt };

  const res = await transport.authenticatedPost(path, body);
  if (!res.success) {
    throw new Error(res.data?.resultMsg || 'items/selectItems failed');
  }

  return extractItemRecords(res.data);
}

async function getOrCreateCursor(branchId) {
  const existing = await prisma.itemRetrievalCursor.findUnique({ where: { branchId } });
  if (existing) return existing;
  return prisma.itemRetrievalCursor.create({
    data: { branchId, lastReqDt: SPEC_DEFAULT_LAST_REQ_DT },
  });
}

/**
 * Retrieves item master records for one branch and snapshots them onto the
 * matching local Product (by sku === itemCd). Never advances the cursor
 * unless every row in this batch was successfully persisted — a retry
 * after failure is safe because the write itself is an idempotent
 * overwrite, not an insert (no dedup step required, unlike item 28*).
 */
async function retrieveAndSync({ branchId = 'main' } = {}) {
  const cursor = await getOrCreateCursor(branchId);
  const requestedLastReqDt = cursor.lastReqDt;

  let items;
  try {
    items = await fetchItems(requestedLastReqDt);
  } catch (error) {
    await prisma.itemRetrievalCursor.update({
      where: { branchId },
      data: { lastSyncError: error.message },
    });
    return { success: false, error: error.message, updated: 0, unmatched: 0, unmatchedItemCodes: [] };
  }

  let updated = 0;
  let unmatched = 0;
  const unmatchedItemCodes = [];
  let persistError = null;

  for (const item of items) {
    try {
      const product = await prisma.product.findUnique({ where: { sku: item.itemCd } });
      if (!product) {
        unmatched += 1;
        unmatchedItemCodes.push(item.itemCd);
        continue;
      }

      await prisma.product.update({
        where: { id: product.id },
        data: { zraItemSnapshot: item, zraSnapshotSyncedAt: new Date() },
      });
      updated += 1;
    } catch (error) {
      persistError = error;
      break;
    }
  }

  if (persistError) {
    await prisma.itemRetrievalCursor.update({
      where: { branchId },
      data: { lastSyncError: persistError.message },
    });
    return { success: false, error: persistError.message, updated, unmatched, unmatchedItemCodes };
  }

  await prisma.itemRetrievalCursor.update({
    where: { branchId },
    data: {
      lastReqDt: formatVsdcDateTime(new Date()),
      lastSyncedAt: new Date(),
      lastSyncError: null,
      lastImportedCount: updated,
    },
  });

  return { success: true, updated, unmatched, unmatchedItemCodes, requestedLastReqDt };
}

module.exports = {
  SPEC_DEFAULT_LAST_REQ_DT,
  extractItemRecords,
  fetchItems,
  getOrCreateCursor,
  retrieveAndSync,
};
