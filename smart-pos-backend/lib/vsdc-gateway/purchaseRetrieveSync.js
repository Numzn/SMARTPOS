/**
 * Item 14* — POST /trnsPurchase/selectTrnsPurchaseSales (VSDC API Spec
 * v1.0.8), "GET PURCHASES". Confirmed MANDATORY per spec text (unlike
 * item 28*'s /stock/selectStockItems and item 10*'s /items/selectItems,
 * which are both optional).
 *
 * Response is two levels deep — data.saleList[] (transaction headers)
 * each with a nested itemList[] — one level deeper than every other
 * retrieve endpoint built so far. A confirmed JSON sample exists for this
 * shape in the spec, so extractPurchaseRecords() expects it directly
 * rather than defensively guessing among several candidates (same
 * confidence level as itemsRetrieveSync.js, not stockRetrieveSync.js).
 *
 * Deliberately NOT matched or linked against GoodsReceivedNote: a
 * regTyCd='A' record (purchase reported by another Smart Invoice user's
 * own VSDC) has no natural local business document to attach to, and
 * forcing a match by date/amount/supplier heuristics would be a
 * fabricated join, not a discovered one. Stored standalone in
 * RetrievedPurchase, deduped by (spplrTpin, spplrBhfId, spplrInvcNo) — the
 * natural supplier-side reference the spec provides, mirroring how sarNo
 * was item 28*'s dedup key. Known limitation, documented in
 * schema.prisma's RetrievedPurchase comment: those three key fields are
 * nullable, and Postgres treats multiple NULLs in a unique constraint as
 * distinct, so a response missing one of them would dedup incorrectly.
 *
 * Cursor: PurchaseRetrievalCursor, structurally identical to
 * StockRetrievalCursor/ItemRetrievalCursor, kept as its own model for the
 * same reason those two are — see their own file headers.
 */
const prisma = require('../prisma');
const transport = require('./transport');
const endpointAdapter = require('./endpointAdapter');

function vsdcCtx() {
  const vsdcService = require('../../services/vsdcService');
  return { tpin: vsdcService.tpin, bhfId: vsdcService.bhfId };
}

// Spec's own stated default for lastReqDt — identical text to items 28*/10*.
const SPEC_DEFAULT_LAST_REQ_DT = '20160523000000';

function formatVsdcDateTime(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function extractPurchaseRecords(responseData) {
  const data = responseData?.data ?? responseData;
  if (!Array.isArray(data?.saleList)) {
    throw new Error(
      'Unrecognized /trnsPurchase/selectTrnsPurchaseSales response shape — expected data.saleList to be an array'
    );
  }
  return data.saleList;
}

async function fetchPurchases(lastReqDt) {
  const ctx = vsdcCtx();
  const path = endpointAdapter.path('purchaseSelect');
  const body = { tpin: ctx.tpin, bhfId: ctx.bhfId, lastReqDt };

  const res = await transport.authenticatedPost(path, body);
  if (!res.success) {
    throw new Error(res.data?.resultMsg || 'trnsPurchase/selectTrnsPurchaseSales failed');
  }

  return extractPurchaseRecords(res.data);
}

async function getOrCreateCursor(branchId) {
  const existing = await prisma.purchaseRetrievalCursor.findUnique({ where: { branchId } });
  if (existing) return existing;
  return prisma.purchaseRetrievalCursor.create({
    data: { branchId, lastReqDt: SPEC_DEFAULT_LAST_REQ_DT },
  });
}

/**
 * Retrieves purchase records for one branch and stores each header as a
 * standalone RetrievedPurchase row (itemList kept raw). Never advances the
 * cursor unless every row in this batch was successfully persisted — a
 * retry after failure is safe because already-persisted rows are deduped
 * by the composite unique key, not reprocessed.
 */
async function retrieveAndSync({ branchId = 'main' } = {}) {
  const cursor = await getOrCreateCursor(branchId);
  const requestedLastReqDt = cursor.lastReqDt;

  let records;
  try {
    records = await fetchPurchases(requestedLastReqDt);
  } catch (error) {
    await prisma.purchaseRetrievalCursor.update({
      where: { branchId },
      data: { lastSyncError: error.message },
    });
    return { success: false, error: error.message, imported: 0, skipped: 0 };
  }

  let imported = 0;
  let skipped = 0;
  let persistError = null;

  for (const record of records) {
    try {
      const key = {
        spplrTpin: record.spplrTpin ?? null,
        spplrBhfId: record.spplrBhfId ?? null,
        spplrInvcNo: record.spplrInvcNo != null ? String(record.spplrInvcNo) : null,
      };
      // findUnique's compound-key shorthand rejects null field values
      // outright ("Argument spplrBhfId must not be null") even though the
      // column itself is nullable — caught live against Numzlab
      // 2026-08-13 when a fixture record with a null spplrBhfId crashed
      // the whole batch instead of just failing to dedup. findFirst with
      // an explicit where clause handles null correctly (Prisma's standard
      // filter semantics, not the unique-index shorthand), and as a side
      // effect resolves the dedup limitation noted on the RetrievedPurchase
      // model: even though Postgres itself treats multiple NULLs in a
      // unique index as distinct, this application-level check still
      // correctly recognizes them as duplicates before ever calling create().
      const existing = await prisma.retrievedPurchase.findFirst({ where: key });
      if (existing) {
        skipped += 1;
        continue;
      }

      await prisma.retrievedPurchase.create({
        data: {
          branchId,
          ...key,
          rcptTyCd: record.rcptTyCd ?? null,
          pmtTyCd: record.pmtTyCd ?? null,
          cfmDt: record.cfmDt ?? null,
          salesDt: record.salesDt ?? null,
          stockRlsDt: record.stockRlsDt ?? null,
          totItemCnt: record.totItemCnt != null ? Number(record.totItemCnt) : null,
          totTaxblAmt: record.totTaxblAmt != null ? Number(record.totTaxblAmt) : null,
          totTaxAmt: record.totTaxAmt != null ? Number(record.totTaxAmt) : null,
          totAmt: record.totAmt != null ? Number(record.totAmt) : null,
          remark: record.remark ?? null,
          spplrNm: record.spplrNm ?? null,
          itemList: Array.isArray(record.itemList) ? record.itemList : [],
        },
      });
      imported += 1;
    } catch (error) {
      persistError = error;
      break;
    }
  }

  if (persistError) {
    await prisma.purchaseRetrievalCursor.update({
      where: { branchId },
      data: { lastSyncError: persistError.message },
    });
    return { success: false, error: persistError.message, imported, skipped };
  }

  await prisma.purchaseRetrievalCursor.update({
    where: { branchId },
    data: {
      lastReqDt: formatVsdcDateTime(new Date()),
      lastSyncedAt: new Date(),
      lastSyncError: null,
      lastImportedCount: imported,
    },
  });

  return { success: true, imported, skipped, requestedLastReqDt };
}

module.exports = {
  SPEC_DEFAULT_LAST_REQ_DT,
  extractPurchaseRecords,
  fetchPurchases,
  getOrCreateCursor,
  retrieveAndSync,
};
