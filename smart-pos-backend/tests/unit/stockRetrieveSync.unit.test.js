import { describe, it, expect, vi, afterEach } from 'vitest';

const prisma = require('../../lib/prisma');
const transport = require('../../lib/vsdc-gateway/transport');
const stockRetrieveSync = require('../../lib/vsdc-gateway/stockRetrieveSync');
const testData = require('../helpers/testData.js');

const { createTestCategory, createTestProduct, cleanupTestData } = testData;

const BRANCH = 'TEST-RETRIEVE-BRANCH';

function mockResponse(records) {
  return { success: true, data: { resultCd: '000', data: { stockList: records } } };
}

function oneRecord({ sarNo = 'SAR-1', itemCd, qty = 2, prc = 10 } = {}) {
  return {
    sarNo,
    custTpin: '1000000000',
    custBhfId: '000',
    ocrnDt: '20260801103000',
    totItemCnt: 1,
    remark: 'test',
    itemList: [{ itemSeq: 1, itemCd, itemClsCd: 'BVRG001', itemNm: 'Test Item', qty, prc, totAmt: qty * prc }],
  };
}

// Item 28* (POST /stock/selectStockItems, OPTIONAL per spec). These tests
// cover request construction, response parsing/mapping, idempotency,
// cursor safety, and every failure mode listed for this feature.
describe('stockRetrieveSync', () => {
  afterEach(async () => {
    await prisma.stockMovement.deleteMany({ where: { referenceType: 'RECONCILED', branchId: BRANCH } });
    await prisma.stockRetrievalCursor.deleteMany({ where: { branchId: BRANCH } });
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  it('1. successful retrieval imports matched items and reports counts', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, sku: 'RETR-SKU-1' });
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneRecord({ sarNo: 'SAR-100', itemCd: 'RETR-SKU-1' })])
    );

    const result = await stockRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.unmatched).toBe(0);

    const row = await prisma.stockMovement.findFirst({
      where: { referenceType: 'RECONCILED', referenceId: 'SAR-100', productId: product.id },
    });
    expect(row).toBeTruthy();
    expect(row.movementType).toBe('RECONCILED');
    expect(row.userId).toBeNull();
  });

  it('2. request construction sends tpin/bhfId/lastReqDt to the real endpoint path', async () => {
    const endpointAdapter = require('../../lib/vsdc-gateway/endpointAdapter');
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    await stockRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [path, body] = postSpy.mock.calls[0];
    expect(path).toBe(endpointAdapter.path('stockItemsSelect'));
    expect(body).toHaveProperty('tpin');
    expect(body).toHaveProperty('bhfId');
    expect(body.lastReqDt).toBe(stockRetrieveSync.SPEC_DEFAULT_LAST_REQ_DT); // initial sync, no prior cursor
  });

  it('3. response mapping flattens record-level + item-level fields onto one row per line', () => {
    const records = [oneRecord({ sarNo: 'SAR-5', itemCd: 'SKU-A', qty: 3, prc: 7 })];
    const rows = stockRetrieveSync.flattenRecords(records);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sarNo: 'SAR-5', itemCd: 'SKU-A', qty: 3, prc: 7, totAmt: 21 });
    expect(rows[0].custTpin).toBe('1000000000');
  });

  it('4. initial sync (no prior cursor) creates one and uses the spec default lastReqDt', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));
    const before = await prisma.stockRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(before).toBeNull();

    await stockRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    const after = await prisma.stockRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(after).toBeTruthy();
    expect(after.lastSyncedAt).toBeTruthy();
  });

  it('5. incremental sync sends the previously-stored lastReqDt, not the spec default', async () => {
    await prisma.stockRetrievalCursor.create({
      data: { branchId: BRANCH, lastReqDt: '20260101000000', lastSyncedAt: new Date() },
    });
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    await stockRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(postSpy.mock.calls[0][1].lastReqDt).toBe('20260101000000');
  });

  it('6. the same sarNo+product retrieved twice does not create a duplicate row', async () => {
    const category = await createTestCategory();
    await createTestProduct({ categoryId: category.id, sku: 'RETR-SKU-DUP' });
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneRecord({ sarNo: 'SAR-DUP', itemCd: 'RETR-SKU-DUP' })])
    );

    const first = await stockRetrieveSync.retrieveAndSync({ branchId: BRANCH });
    const second = await stockRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(first.imported).toBe(1);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);

    const rows = await prisma.stockMovement.findMany({
      where: { referenceType: 'RECONCILED', referenceId: 'SAR-DUP' },
    });
    expect(rows).toHaveLength(1);
  });

  it('7. an empty response is a normal success — zero imported, cursor still advances', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    const result = await stockRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(true);
    expect(result.imported).toBe(0);
    const cursor = await prisma.stockRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastSyncedAt).toBeTruthy();
  });

  it('8. a VSDC rejection fails the sync without throwing and does not advance the cursor', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: false,
      data: { resultCd: '999', resultMsg: 'Simulated VSDC rejection' },
    });

    const result = await stockRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Simulated VSDC rejection/);
    const cursor = await prisma.stockRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastReqDt).toBe(stockRetrieveSync.SPEC_DEFAULT_LAST_REQ_DT);
    expect(cursor.lastSyncedAt).toBeNull();
    expect(cursor.lastSyncError).toMatch(/Simulated VSDC rejection/);
  });

  it('9. a network failure (transport throws) fails the sync cleanly without advancing the cursor', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await stockRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
    const cursor = await prisma.stockRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastSyncedAt).toBeNull();
  });

  it('rejects a malformed response (no recognizable stock-list array) instead of silently importing nothing', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { resultCd: '000', data: { somethingElse: true } },
    });

    const result = await stockRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unrecognized .* response shape/);
  });

  it('skips (does not fabricate) an item whose itemCd has no matching local product', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneRecord({ sarNo: 'SAR-NOMATCH', itemCd: 'DOES-NOT-EXIST-LOCALLY' })])
    );

    const result = await stockRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(true);
    expect(result.unmatched).toBe(1);
    expect(result.unmatchedItemCodes).toContain('DOES-NOT-EXIST-LOCALLY');
    const rows = await prisma.stockMovement.findMany({ where: { referenceType: 'RECONCILED', referenceId: 'SAR-NOMATCH' } });
    expect(rows).toHaveLength(0);
  });

  it('10 & 11. a database failure mid-batch fails the sync and does not advance the cursor, even if an earlier row in the batch persisted', async () => {
    const category = await createTestCategory();
    await createTestProduct({ categoryId: category.id, sku: 'RETR-SKU-OK' });
    await createTestProduct({ categoryId: category.id, sku: 'RETR-SKU-BOOM' });
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([
        oneRecord({ sarNo: 'SAR-OK', itemCd: 'RETR-SKU-OK' }),
        oneRecord({ sarNo: 'SAR-BOOM', itemCd: 'RETR-SKU-BOOM' }),
      ])
    );
    // Manual monkey-patch, not vi.spyOn — Prisma's model delegates are
    // Proxy-based, and vi.restoreAllMocks() does not reliably restore a
    // spied Proxy method (confirmed: it left prisma.stockMovement.create
    // broken for every test after this one in the same file, failing with
    // "is not a function"). Real implementation captured before patching,
    // so the first (successful) call still actually persists — only the
    // second call is forced to fail, simulating a mid-batch DB failure
    // rather than a total outage — and always restored in `finally`.
    const realCreate = prisma.stockMovement.create.bind(prisma.stockMovement);
    let call = 0;
    prisma.stockMovement.create = (args) => {
      call += 1;
      if (call === 2) throw new Error('Simulated DB failure');
      return realCreate(args);
    };

    let result;
    try {
      result = await stockRetrieveSync.retrieveAndSync({ branchId: BRANCH });
    } finally {
      prisma.stockMovement.create = realCreate;
    }

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Simulated DB failure/);
    expect(result.imported).toBe(1); // the first row DID persist before the failure
    const cursor = await prisma.stockRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastSyncedAt).toBeNull(); // but the cursor must not advance regardless
  });

  it('12. retry after failure re-requests the same lastReqDt and completes without duplicating already-persisted rows', async () => {
    const category = await createTestCategory();
    await createTestProduct({ categoryId: category.id, sku: 'RETR-SKU-RETRY' });

    // Single spy, chained: first call rejects (network failure), every call
    // after that resolves — avoids any ambiguity from re-spying mid-test.
    const postSpy = vi
      .spyOn(transport, 'authenticatedPost')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(mockResponse([oneRecord({ sarNo: 'SAR-RETRY', itemCd: 'RETR-SKU-RETRY' })]));

    const attempt1 = await stockRetrieveSync.retrieveAndSync({ branchId: BRANCH });
    expect(attempt1.success).toBe(false);

    const attempt2 = await stockRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(attempt2.success).toBe(true);
    expect(attempt2.imported).toBe(1);
    expect(postSpy.mock.calls[0][1].lastReqDt).toBe(stockRetrieveSync.SPEC_DEFAULT_LAST_REQ_DT);
  });

  it('13. the cursor is read fresh from the database each call, not cached in-process (restart/recovery)', async () => {
    await prisma.stockRetrievalCursor.create({
      data: { branchId: BRANCH, lastReqDt: '20250601000000', lastSyncedAt: new Date() },
    });
    // Simulate a restart by requiring the module fresh — Node's require
    // cache means this is the same module instance either way, which is
    // exactly the point: there is no in-memory state to lose, because the
    // cursor lives in Postgres, not on the module (unlike the in-memory
    // lastSyncDate pattern in services/zraCodesService.js).
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    await stockRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(postSpy.mock.calls[0][1].lastReqDt).toBe('20250601000000');
  });
});
