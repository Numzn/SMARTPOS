/**
 * Item 28* — POST /stock/selectStockItems (VSDC API Spec v1.0.8). Confirmed
 * OPTIONAL per the spec text (unlike saveStockItems/saveStockMaster, which
 * are MANDATORY except service industry / MANDATORY respectively) — built
 * regardless, per instruction, but the distinction is real and documented
 * in zra-self-checklist.md.
 *
 * Pulls stock records ZRA already has on file and reconciles them against
 * local data — it does NOT create or trust these as new operational
 * inventory changes. The spec's response field list for this endpoint has
 * no direction/sarTyCd equivalent (confirmed by reading the field table
 * directly; the JSON sample shown adjacent to it in the source PDF is for
 * a different, unrelated endpoint — a known extraction artifact, see the
 * mock server's comment), so whether a retrieved qty represents an
 * increase or decrease can't be safely inferred. Every retrieved line is
 * stored as a StockMovementType.RECONCILED row — a reconciliation
 * snapshot — and Inventory.currentStock is never touched by this sync.
 *
 * Idempotency: sarNo is the ZRA-assigned Stock Accounting Record Number —
 * the natural uniqueness key the spec provides. Deduped per (sarNo,
 * productId) since one sarNo can cover multiple item lines.
 *
 * Cursor safety: StockRetrievalCursor.lastReqDt only advances after every
 * line in the batch has been durably persisted (or already existed) — see
 * retrieveAndSync's error handling.
 */
const prisma = require('../prisma');
const transport = require('./transport');
const endpointAdapter = require('./endpointAdapter');

function vsdcCtx() {
  const vsdcService = require('../../services/vsdcService');
  return { tpin: vsdcService.tpin, bhfId: vsdcService.bhfId };
}

// Spec's own stated default for lastReqDt when there's no prior cursor
// ("By default, this defaults to 20160523000000") — not invented.
const SPEC_DEFAULT_LAST_REQ_DT = '20160523000000';

function formatVsdcDateTime(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// The spec text for this endpoint has no confirmed JSON response sample
// (see file header) — accepts a few plausible wrapper shapes rather than
// assuming one, and throws clearly if none match rather than silently
// treating a malformed response as "zero records".
function extractStockRecords(responseData) {
  const data = responseData?.data ?? responseData;
  const candidates = [data?.stockList, data?.stockItemList, data?.list, Array.isArray(data) ? data : null];
  const records = candidates.find((c) => Array.isArray(c));
  if (!records) {
    throw new Error(
      'Unrecognized /stock/selectStockItems response shape — expected data.stockList (or .stockItemList/.list) to be an array'
    );
  }
  return records;
}

// Flattens {sarNo, ..., itemList: [...]} records into one row per item line,
// carrying the record-level fields down onto each line.
function flattenRecords(records) {
  const rows = [];
  for (const record of records) {
    const items = Array.isArray(record.itemList) ? record.itemList : [];
    for (const item of items) {
      rows.push({
        sarNo: String(record.sarNo),
        custTpin: record.custTpin ?? null,
        custBhfId: record.custBhfId ?? null,
        ocrnDt: record.ocrnDt ?? null,
        remark: record.remark ?? null,
        itemCd: item.itemCd,
        itemClsCd: item.itemClsCd ?? null,
        itemNm: item.itemNm ?? null,
        qty: item.qty != null ? Number(item.qty) : null,
        prc: item.prc != null ? Number(item.prc) : null,
        totAmt: item.totAmt != null ? Number(item.totAmt) : null,
      });
    }
  }
  return rows;
}

async function fetchStockItems(lastReqDt) {
  const ctx = vsdcCtx();
  const path = endpointAdapter.path('stockItemsSelect');
  const body = { tpin: ctx.tpin, bhfId: ctx.bhfId, lastReqDt };

  const res = await transport.authenticatedPost(path, body);
  if (!res.success) {
    throw new Error(res.data?.resultMsg || 'stock/selectStockItems failed');
  }

  const records = extractStockRecords(res.data);
  return flattenRecords(records);
}

async function getOrCreateCursor(branchId) {
  const existing = await prisma.stockRetrievalCursor.findUnique({ where: { branchId } });
  if (existing) return existing;
  return prisma.stockRetrievalCursor.create({
    data: { branchId, lastReqDt: SPEC_DEFAULT_LAST_REQ_DT },
  });
}

/**
 * Retrieves and reconciles stock records for one branch. Never advances
 * the cursor unless every row in this batch was successfully persisted
 * (or was already present — a partial-failure retry is safe precisely
 * because already-persisted rows are deduped, not reprocessed).
 */
async function retrieveAndSync({ branchId = 'main' } = {}) {
  const cursor = await getOrCreateCursor(branchId);
  const requestedLastReqDt = cursor.lastReqDt;

  let rows;
  try {
    rows = await fetchStockItems(requestedLastReqDt);
  } catch (error) {
    await prisma.stockRetrievalCursor.update({
      where: { branchId },
      data: { lastSyncError: error.message },
    });
    return { success: false, error: error.message, imported: 0, skipped: 0, unmatched: 0 };
  }

  let imported = 0;
  let skipped = 0;
  let unmatched = 0;
  const unmatchedItemCodes = [];
  let persistError = null;

  for (const row of rows) {
    try {
      const product = await prisma.product.findUnique({ where: { sku: row.itemCd } });
      if (!product) {
        unmatched += 1;
        unmatchedItemCodes.push(row.itemCd);
        continue;
      }

      const alreadyImported = await prisma.stockMovement.findFirst({
        where: { referenceType: 'RECONCILED', referenceId: row.sarNo, productId: product.id },
      });
      if (alreadyImported) {
        skipped += 1;
        continue;
      }

      const inventory = await prisma.inventory.findUnique({
        where: { productId_branchId: { productId: product.id, branchId } },
      });
      const currentStock = inventory?.currentStock ?? 0;

      await prisma.stockMovement.create({
        data: {
          productId: product.id,
          branchId,
          movementType: 'RECONCILED',
          quantity: row.qty != null ? Math.round(row.qty) : 0,
          // Reconciliation snapshot only — does not represent an applied
          // change, so previous/new are both the actual current level.
          previousStock: currentStock,
          newStock: currentStock,
          unitCost: row.prc,
          totalCost: row.totAmt,
          referenceType: 'RECONCILED',
          referenceId: row.sarNo,
          reason: row.remark || 'Retrieved from ZRA (selectStockItems)',
          notes: `itemClsCd=${row.itemClsCd || 'n/a'} ocrnDt=${row.ocrnDt || 'n/a'}`,
          userId: null,
        },
      });
      imported += 1;
    } catch (error) {
      persistError = error;
      break;
    }
  }

  if (persistError) {
    await prisma.stockRetrievalCursor.update({
      where: { branchId },
      data: { lastSyncError: persistError.message },
    });
    return {
      success: false,
      error: persistError.message,
      imported,
      skipped,
      unmatched,
      unmatchedItemCodes,
    };
  }

  await prisma.stockRetrievalCursor.update({
    where: { branchId },
    data: {
      lastReqDt: formatVsdcDateTime(new Date()),
      lastSyncedAt: new Date(),
      lastSyncError: null,
      lastImportedCount: imported,
    },
  });

  return { success: true, imported, skipped, unmatched, unmatchedItemCodes, requestedLastReqDt };
}

module.exports = {
  SPEC_DEFAULT_LAST_REQ_DT,
  extractStockRecords,
  flattenRecords,
  fetchStockItems,
  getOrCreateCursor,
  retrieveAndSync,
};
