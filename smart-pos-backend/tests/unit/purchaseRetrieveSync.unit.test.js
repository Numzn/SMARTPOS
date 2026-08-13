import { describe, it, expect, vi, afterEach } from 'vitest';

const prisma = require('../../lib/prisma');
const transport = require('../../lib/vsdc-gateway/transport');
const purchaseRetrieveSync = require('../../lib/vsdc-gateway/purchaseRetrieveSync');
const testData = require('../helpers/testData.js');

const { cleanupTestData } = testData;

const BRANCH = 'TEST-PURCHASE-RETRIEVE-BRANCH';

function mockResponse(saleList) {
  return { success: true, data: { resultCd: '000', data: { saleList } } };
}

function oneSale({ spplrTpin = '2000000000', spplrBhfId = '000', spplrInvcNo = '1001', totAmt = 23.2 } = {}) {
  return {
    spplrTpin,
    spplrNm: 'Test Supplier',
    spplrBhfId,
    spplrInvcNo,
    rcptTyCd: 'P',
    pmtTyCd: '02',
    cfmDt: '20260801102000',
    salesDt: '20260801',
    stockRlsDt: null,
    totItemCnt: 1,
    totTaxblAmt: 20,
    totTaxAmt: 3.2,
    totAmt,
    remark: 'test',
    itemList: [
      { itemSeq: 1, itemCd: 'COKE500', itemClsCd: 'BVRG001', itemNm: 'Test Item', qty: 2, prc: 10, totAmt },
    ],
  };
}

// Item 14* (POST /trnsPurchase/selectTrnsPurchaseSales, MANDATORY per
// spec). Mirrors item 28*/10*'s retrieve-sync test coverage, adapted for
// the two-level saleList[].itemList[] nesting and the standalone (no
// local matching) storage design.
describe('purchaseRetrieveSync', () => {
  afterEach(async () => {
    await prisma.retrievedPurchase.deleteMany({ where: { branchId: BRANCH } });
    await prisma.purchaseRetrievalCursor.deleteMany({ where: { branchId: BRANCH } });
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  it('1. successful retrieval imports header records and reports counts', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneSale({ spplrInvcNo: '2001' })])
    );

    const result = await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);

    const row = await prisma.retrievedPurchase.findFirst({ where: { branchId: BRANCH, spplrInvcNo: '2001' } });
    expect(row).toBeTruthy();
    expect(row.itemList).toHaveLength(1);
  });

  it('2. request construction sends tpin/bhfId/lastReqDt to the real endpoint path', async () => {
    const endpointAdapter = require('../../lib/vsdc-gateway/endpointAdapter');
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [path, body] = postSpy.mock.calls[0];
    expect(path).toBe(endpointAdapter.path('purchaseSelect'));
    expect(body.lastReqDt).toBe(purchaseRetrieveSync.SPEC_DEFAULT_LAST_REQ_DT);
  });

  it('3. extractPurchaseRecords accepts a data.saleList array', () => {
    const saleList = [oneSale()];
    const extracted = purchaseRetrieveSync.extractPurchaseRecords({ resultCd: '000', data: { saleList } });
    expect(extracted).toEqual(saleList);
  });

  it('4. extractPurchaseRecords throws clearly on an unrecognized shape', () => {
    expect(() =>
      purchaseRetrieveSync.extractPurchaseRecords({ resultCd: '000', data: { itemList: [] } })
    ).toThrow(/Unrecognized .* response shape/);
  });

  it('5. initial sync (no prior cursor) creates one and uses the spec default lastReqDt', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));
    const before = await prisma.purchaseRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(before).toBeNull();

    await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    const after = await prisma.purchaseRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(after).toBeTruthy();
    expect(after.lastSyncedAt).toBeTruthy();
  });

  it('6. incremental sync sends the previously-stored lastReqDt, not the spec default', async () => {
    await prisma.purchaseRetrievalCursor.create({
      data: { branchId: BRANCH, lastReqDt: '20260101000000', lastSyncedAt: new Date() },
    });
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(postSpy.mock.calls[0][1].lastReqDt).toBe('20260101000000');
  });

  it('7. the same (spplrTpin, spplrBhfId, spplrInvcNo) retrieved twice is deduped, not duplicated', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneSale({ spplrInvcNo: '3001' })])
    );

    const first = await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });
    const second = await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(first.imported).toBe(1);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);

    const rows = await prisma.retrievedPurchase.findMany({ where: { branchId: BRANCH, spplrInvcNo: '3001' } });
    expect(rows).toHaveLength(1);
  });

  it('8. an empty response is a normal success — zero imported, cursor still advances', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    const result = await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(true);
    expect(result.imported).toBe(0);
    const cursor = await prisma.purchaseRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastSyncedAt).toBeTruthy();
  });

  it('9. a VSDC rejection fails the sync without throwing and does not advance the cursor', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: false,
      data: { resultCd: '999', resultMsg: 'Simulated VSDC rejection' },
    });

    const result = await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(false);
    const cursor = await prisma.purchaseRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastReqDt).toBe(purchaseRetrieveSync.SPEC_DEFAULT_LAST_REQ_DT);
    expect(cursor.lastSyncedAt).toBeNull();
    expect(cursor.lastSyncError).toMatch(/Simulated VSDC rejection/);
  });

  it('10. a network failure (transport throws) fails the sync cleanly without advancing the cursor', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
    const cursor = await prisma.purchaseRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastSyncedAt).toBeNull();
  });

  it('11. rejects a malformed response (no saleList array) instead of silently importing nothing', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { resultCd: '000', data: { somethingElse: true } },
    });

    const result = await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unrecognized .* response shape/);
  });

  it('12. a database failure mid-batch fails the sync and does not advance the cursor, even if an earlier row persisted', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneSale({ spplrInvcNo: '4001' }), oneSale({ spplrInvcNo: '4002' })])
    );
    const realCreate = prisma.retrievedPurchase.create.bind(prisma.retrievedPurchase);
    let call = 0;
    prisma.retrievedPurchase.create = (args) => {
      call += 1;
      if (call === 2) throw new Error('Simulated DB failure');
      return realCreate(args);
    };

    let result;
    try {
      result = await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });
    } finally {
      prisma.retrievedPurchase.create = realCreate;
    }

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Simulated DB failure/);
    expect(result.imported).toBe(1);
    const cursor = await prisma.purchaseRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastSyncedAt).toBeNull();
  });

  it('13. retry after failure re-requests the same lastReqDt and completes without duplicating', async () => {
    const postSpy = vi
      .spyOn(transport, 'authenticatedPost')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(mockResponse([oneSale({ spplrInvcNo: '5001' })]));

    const attempt1 = await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });
    expect(attempt1.success).toBe(false);

    const attempt2 = await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(attempt2.success).toBe(true);
    expect(attempt2.imported).toBe(1);
    expect(postSpy.mock.calls[0][1].lastReqDt).toBe(purchaseRetrieveSync.SPEC_DEFAULT_LAST_REQ_DT);
  });

  it('14b. REGRESSION: a record with a null spplrBhfId does not crash the batch — caught 2026-08-13 by live verification, not by any earlier unit test (all prior fixtures happened to populate every dedup field)', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneSale({ spplrInvcNo: '9001', spplrBhfId: null })])
    );

    const result = await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);

    const row = await prisma.retrievedPurchase.findFirst({ where: { branchId: BRANCH, spplrInvcNo: '9001' } });
    expect(row).toBeTruthy();
    expect(row.spplrBhfId).toBeNull();

    // Re-running must dedup this null-bhfId row too, not just avoid crashing.
    const second = await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('14. the cursor is read fresh from the database each call, not cached in-process', async () => {
    await prisma.purchaseRetrievalCursor.create({
      data: { branchId: BRANCH, lastReqDt: '20250601000000', lastSyncedAt: new Date() },
    });
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(postSpy.mock.calls[0][1].lastReqDt).toBe('20250601000000');
  });

  it('15. two-level nesting round-trips correctly — itemList stored raw, totItemCnt matches item count', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneSale({ spplrInvcNo: '6001' })])
    );

    await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    const row = await prisma.retrievedPurchase.findFirst({ where: { branchId: BRANCH, spplrInvcNo: '6001' } });
    expect(row.totItemCnt).toBe(row.itemList.length);
    expect(row.itemList[0].itemCd).toBe('COKE500');
  });

  it('16. never matches or fabricates a local Product/GoodsReceivedNote link — purely standalone storage', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneSale({ spplrInvcNo: '7001' })])
    );

    await purchaseRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    const row = await prisma.retrievedPurchase.findFirst({ where: { branchId: BRANCH, spplrInvcNo: '7001' } });
    expect(row).not.toHaveProperty('goodsReceivedNoteId');
    expect(row).not.toHaveProperty('productId');
  });
});
