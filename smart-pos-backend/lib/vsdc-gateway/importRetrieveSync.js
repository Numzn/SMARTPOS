/**
 * Item 11* — POST /imports/selectImportItems (VSDC API Spec v1.0.8), "GET
 * IMPORTS". Confirmed MANDATORY per spec text.
 *
 * Retrieves customs import declarations (ASYCUDA data) reported against
 * our TPIN — HS codes, country of origin, foreign-currency amounts,
 * declaration numbers. Response is a flat data.itemList[] (unlike item
 * 14*'s two-level data.saleList[].itemList[]), and a confirmed JSON
 * sample exists for it, so extractImportRecords() expects the shape
 * directly rather than guessing.
 *
 * Retrieved lines are stored standalone in RetrievedImportItem — nothing
 * local corresponds to a customs import until a human reviews and decides
 * it (see importDecisionSync.js for item 12*, the approve/reject step).
 * Dedup key is (taskCd, itemSeq), the declaration's own task code + line
 * sequence — the natural identifier the spec provides, mirroring how
 * sarNo/the purchase composite key were used for items 28* and 14*.
 *
 * Cursor: ImportRetrievalCursor, structurally identical to
 * StockRetrievalCursor/PurchaseRetrievalCursor, kept as its own model for
 * the same reason those are.
 */
const prisma = require('../prisma');
const transport = require('./transport');
const endpointAdapter = require('./endpointAdapter');

function vsdcCtx() {
  const vsdcService = require('../../services/vsdcService');
  return { tpin: vsdcService.tpin, bhfId: vsdcService.bhfId };
}

// Spec's own stated default for lastReqDt — identical text to items 28*/10*/14*.
const SPEC_DEFAULT_LAST_REQ_DT = '20160523000000';

function formatVsdcDateTime(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function extractImportRecords(responseData) {
  const data = responseData?.data ?? responseData;
  if (!Array.isArray(data?.itemList)) {
    throw new Error(
      'Unrecognized /imports/selectImportItems response shape — expected data.itemList to be an array'
    );
  }
  return data.itemList;
}

async function fetchImportItems(lastReqDt) {
  const ctx = vsdcCtx();
  const path = endpointAdapter.path('importsSelect');
  const body = { tpin: ctx.tpin, bhfId: ctx.bhfId, lastReqDt };

  const res = await transport.authenticatedPost(path, body);
  if (!res.success) {
    throw new Error(res.data?.resultMsg || 'imports/selectImportItems failed');
  }

  return extractImportRecords(res.data);
}

async function getOrCreateCursor(branchId) {
  const existing = await prisma.importRetrievalCursor.findUnique({ where: { branchId } });
  if (existing) return existing;
  return prisma.importRetrievalCursor.create({
    data: { branchId, lastReqDt: SPEC_DEFAULT_LAST_REQ_DT },
  });
}

/**
 * Retrieves import declaration lines for one branch and stores each as a
 * standalone RetrievedImportItem row (decision defaults PENDING). Never
 * advances the cursor unless every row in this batch was successfully
 * persisted — a retry after failure is safe because already-persisted
 * rows are deduped by (taskCd, itemSeq), not reprocessed.
 */
async function retrieveAndSync({ branchId = 'main' } = {}) {
  const cursor = await getOrCreateCursor(branchId);
  const requestedLastReqDt = cursor.lastReqDt;

  let records;
  try {
    records = await fetchImportItems(requestedLastReqDt);
  } catch (error) {
    await prisma.importRetrievalCursor.update({
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
      const taskCd = record.taskCd != null ? String(record.taskCd) : null;
      const itemSeq = record.itemSeq != null ? Number(record.itemSeq) : null;
      if (!taskCd || itemSeq == null) {
        // No usable identity key — skip rather than persist an
        // unretrievable/undedupable row.
        skipped += 1;
        continue;
      }

      const existing = await prisma.retrievedImportItem.findFirst({ where: { taskCd, itemSeq } });
      if (existing) {
        skipped += 1;
        continue;
      }

      await prisma.retrievedImportItem.create({
        data: {
          branchId,
          taskCd,
          itemSeq,
          dclDe: record.dclDe ?? null,
          dclNo: record.dclNo ?? null,
          hsCd: record.hsCd ?? null,
          itemNm: record.itemNm ?? null,
          imptItemSttsCd: record.imptItemsttsCd ?? record.imptItemSttsCd ?? null,
          orgnNatCd: record.orgnNatCd ?? null,
          exptNatCd: record.exptNatCd ?? null,
          pkg: record.pkg != null ? Number(record.pkg) : null,
          pkgUnitCd: record.pkgUnitCd ?? null,
          qty: record.qty != null ? Number(record.qty) : null,
          qtyUnitCd: record.qtyUnitCd ?? null,
          totWt: record.totWt != null ? Number(record.totWt) : null,
          netWt: record.netWt != null ? Number(record.netWt) : null,
          spplrNm: record.spplrNm ?? null,
          agntNm: record.agntNm ?? null,
          invcFcurAmt: record.invcFcurAmt != null ? Number(record.invcFcurAmt) : null,
          invcFcurCd: record.invcFcurCd ?? null,
          invcFcurExcrt: record.invcFcurExcrt != null ? Number(record.invcFcurExcrt) : null,
          dclRefNum: record.dclRefNum ?? null,
        },
      });
      imported += 1;
    } catch (error) {
      persistError = error;
      break;
    }
  }

  if (persistError) {
    await prisma.importRetrievalCursor.update({
      where: { branchId },
      data: { lastSyncError: persistError.message },
    });
    return { success: false, error: persistError.message, imported, skipped };
  }

  await prisma.importRetrievalCursor.update({
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
  extractImportRecords,
  fetchImportItems,
  getOrCreateCursor,
  retrieveAndSync,
};
