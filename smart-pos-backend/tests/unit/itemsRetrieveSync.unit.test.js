import { describe, it, expect, vi, afterEach } from 'vitest';

const prisma = require('../../lib/prisma');
const transport = require('../../lib/vsdc-gateway/transport');
const itemsRetrieveSync = require('../../lib/vsdc-gateway/itemsRetrieveSync');
const testData = require('../helpers/testData.js');

const { createTestCategory, createTestProduct, cleanupTestData } = testData;

const BRANCH = 'TEST-ITEMS-RETRIEVE-BRANCH';

function mockResponse(itemList) {
  return { success: true, data: { resultCd: '000', data: { itemList } } };
}

function oneItem({ itemCd, itemNm = 'ZRA Item Name', dftPrc = 99, bcd = 'ZRA-BARCODE-999', itemClsCd = 'BVRG001' } = {}) {
  return {
    tpin: '1000000000',
    itemCd,
    itemClsCd,
    itemTyCd: '2',
    itemNm,
    itemStdNm: itemNm,
    orgnNatCd: 'ZM',
    pkgUnitCd: 'EA',
    qtyUnitCd: 'EA',
    vatCatCd: 'A',
    btchNo: null,
    regBhfId: '000',
    bcd,
    dftPrc,
    manufacturerTpin: null,
    manufacturerItemCd: null,
    rrp: dftPrc,
    svcChargeYn: 'N',
    rentalYn: 'N',
    addInfo: null,
    sftyQty: 0,
    isrcAplcbYn: 'N',
    ZRAModYn: 'N',
    useYn: 'Y',
  };
}

// Item 10* (POST /items/selectItems, OPTIONAL per spec). Mirrors item 28*'s
// stockRetrieveSync test coverage, minus sarNo/flatten cases (this endpoint
// returns an item master list, not an event log) and plus a case proving
// the snapshot write never overwrites operational Product fields.
describe('itemsRetrieveSync', () => {
  afterEach(async () => {
    await prisma.itemRetrievalCursor.deleteMany({ where: { branchId: BRANCH } });
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  it('1. successful retrieval updates matched items and reports counts', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, sku: 'ITEMS-SKU-1' });
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneItem({ itemCd: 'ITEMS-SKU-1' })])
    );

    const result = await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(true);
    expect(result.updated).toBe(1);
    expect(result.unmatched).toBe(0);

    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(refreshed.zraItemSnapshot).toBeTruthy();
    expect(refreshed.zraItemSnapshot.itemCd).toBe('ITEMS-SKU-1');
    expect(refreshed.zraSnapshotSyncedAt).toBeTruthy();
  });

  it('2. request construction sends tpin/bhfId/lastReqDt to the real endpoint path', async () => {
    const endpointAdapter = require('../../lib/vsdc-gateway/endpointAdapter');
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [path, body] = postSpy.mock.calls[0];
    expect(path).toBe(endpointAdapter.path('itemsSelect'));
    expect(body).toHaveProperty('tpin');
    expect(body).toHaveProperty('bhfId');
    expect(body.lastReqDt).toBe(itemsRetrieveSync.SPEC_DEFAULT_LAST_REQ_DT); // initial sync, no prior cursor
  });

  it('3. extractItemRecords accepts a data.itemList array', () => {
    const items = [oneItem({ itemCd: 'SKU-A' })];
    const extracted = itemsRetrieveSync.extractItemRecords({ resultCd: '000', data: { itemList: items } });
    expect(extracted).toEqual(items);
  });

  it('4. extractItemRecords throws clearly on an unrecognized shape', () => {
    expect(() => itemsRetrieveSync.extractItemRecords({ resultCd: '000', data: { somethingElse: true } })).toThrow(
      /Unrecognized .* response shape/
    );
  });

  it('5. initial sync (no prior cursor) creates one and uses the spec default lastReqDt', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));
    const before = await prisma.itemRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(before).toBeNull();

    await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    const after = await prisma.itemRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(after).toBeTruthy();
    expect(after.lastSyncedAt).toBeTruthy();
  });

  it('6. incremental sync sends the previously-stored lastReqDt, not the spec default', async () => {
    await prisma.itemRetrievalCursor.create({
      data: { branchId: BRANCH, lastReqDt: '20260101000000', lastSyncedAt: new Date() },
    });
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(postSpy.mock.calls[0][1].lastReqDt).toBe('20260101000000');
  });

  it('7. snapshot write never overwrites operational Product fields', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({
      categoryId: category.id,
      sku: 'ITEMS-SKU-SNAPSHOT',
      name: 'Local Operational Name',
      price: 42,
      barcode: 'LOCAL-BARCODE-42',
    });
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([
        oneItem({ itemCd: 'ITEMS-SKU-SNAPSHOT', itemNm: 'ZRA Says Different Name', dftPrc: 999, bcd: 'ZRA-DIFFERENT-BARCODE' }),
      ])
    );

    await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(refreshed.name).toBe('Local Operational Name');
    expect(refreshed.price).toBe(42);
    expect(refreshed.barcode).toBe('LOCAL-BARCODE-42');
    expect(refreshed.sku).toBe('ITEMS-SKU-SNAPSHOT');
    expect(refreshed.zraItemSnapshot.itemNm).toBe('ZRA Says Different Name');
  });

  it('8. re-running a sync for the same item is idempotent — no dedup mechanism needed', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, sku: 'ITEMS-SKU-REPEAT' });
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneItem({ itemCd: 'ITEMS-SKU-REPEAT' })])
    );

    const first = await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });
    const second = await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(first.updated).toBe(1);
    expect(second.updated).toBe(1); // overwritten again, not skipped — no dedup table exists
    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(refreshed.zraItemSnapshot.itemCd).toBe('ITEMS-SKU-REPEAT');
  });

  it('9. an empty response is a normal success — zero updated, cursor still advances', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    const result = await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(true);
    expect(result.updated).toBe(0);
    const cursor = await prisma.itemRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastSyncedAt).toBeTruthy();
  });

  it('10. a VSDC rejection fails the sync without throwing and does not advance the cursor', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: false,
      data: { resultCd: '999', resultMsg: 'Simulated VSDC rejection' },
    });

    const result = await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Simulated VSDC rejection/);
    const cursor = await prisma.itemRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastReqDt).toBe(itemsRetrieveSync.SPEC_DEFAULT_LAST_REQ_DT);
    expect(cursor.lastSyncedAt).toBeNull();
    expect(cursor.lastSyncError).toMatch(/Simulated VSDC rejection/);
  });

  it('11. a network failure (transport throws) fails the sync cleanly without advancing the cursor', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
    const cursor = await prisma.itemRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastSyncedAt).toBeNull();
  });

  it('12. rejects a malformed response (no recognizable itemList array) instead of silently importing nothing', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { resultCd: '000', data: { somethingElse: true } },
    });

    const result = await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unrecognized .* response shape/);
  });

  it('13. skips (does not fabricate) an item whose itemCd has no matching local product', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneItem({ itemCd: 'DOES-NOT-EXIST-LOCALLY' })])
    );

    const result = await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(true);
    expect(result.unmatched).toBe(1);
    expect(result.unmatchedItemCodes).toContain('DOES-NOT-EXIST-LOCALLY');
    const fabricated = await prisma.product.findUnique({ where: { sku: 'DOES-NOT-EXIST-LOCALLY' } });
    expect(fabricated).toBeNull();
  });

  it('14. a database failure mid-batch fails the sync, preserves the partial updated count, and does not advance the cursor', async () => {
    const category = await createTestCategory();
    await createTestProduct({ categoryId: category.id, sku: 'ITEMS-SKU-OK' });
    await createTestProduct({ categoryId: category.id, sku: 'ITEMS-SKU-BOOM' });
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneItem({ itemCd: 'ITEMS-SKU-OK' }), oneItem({ itemCd: 'ITEMS-SKU-BOOM' })])
    );
    // Manual monkey-patch, not vi.spyOn — see stockRetrieveSync.unit.test.js's
    // identical comment: Prisma's model delegates are Proxy-based and
    // vi.restoreAllMocks() does not reliably restore a spied Proxy method.
    const realUpdate = prisma.product.update.bind(prisma.product);
    let call = 0;
    prisma.product.update = (args) => {
      call += 1;
      if (call === 2) throw new Error('Simulated DB failure');
      return realUpdate(args);
    };

    let result;
    try {
      result = await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });
    } finally {
      prisma.product.update = realUpdate;
    }

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Simulated DB failure/);
    expect(result.updated).toBe(1); // the first row DID persist before the failure
    const cursor = await prisma.itemRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastSyncedAt).toBeNull(); // but the cursor must not advance regardless
  });

  it('15. retry after failure re-requests the same lastReqDt and completes without error', async () => {
    const category = await createTestCategory();
    await createTestProduct({ categoryId: category.id, sku: 'ITEMS-SKU-RETRY' });

    const postSpy = vi
      .spyOn(transport, 'authenticatedPost')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(mockResponse([oneItem({ itemCd: 'ITEMS-SKU-RETRY' })]));

    const attempt1 = await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });
    expect(attempt1.success).toBe(false);

    const attempt2 = await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(attempt2.success).toBe(true);
    expect(attempt2.updated).toBe(1);
    expect(postSpy.mock.calls[0][1].lastReqDt).toBe(itemsRetrieveSync.SPEC_DEFAULT_LAST_REQ_DT);
  });

  it('16. the cursor is read fresh from the database each call, not cached in-process (restart/recovery)', async () => {
    await prisma.itemRetrievalCursor.create({
      data: { branchId: BRANCH, lastReqDt: '20250601000000', lastSyncedAt: new Date() },
    });
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    await itemsRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(postSpy.mock.calls[0][1].lastReqDt).toBe('20250601000000');
  });
});
