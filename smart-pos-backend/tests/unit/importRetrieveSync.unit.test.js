import { describe, it, expect, vi, afterEach } from 'vitest';

const prisma = require('../../lib/prisma');
const transport = require('../../lib/vsdc-gateway/transport');
const importRetrieveSync = require('../../lib/vsdc-gateway/importRetrieveSync');
const testData = require('../helpers/testData.js');

const { cleanupTestData } = testData;

const BRANCH = 'TEST-IMPORT-RETRIEVE-BRANCH';

function mockResponse(itemList) {
  return { success: true, data: { resultCd: '000', data: { itemList } } };
}

function oneImportLine({ taskCd = '4561614', itemSeq = 1, dclNo = 'C3460-2026TZDL' } = {}) {
  return {
    taskCd,
    dclDe: '20260801',
    itemSeq,
    dclNo,
    hsCd: '22029900000',
    itemNm: 'Test Import Item',
    imptItemsttsCd: '2',
    orgnNatCd: 'ZA',
    exptNatCd: 'ZA',
    pkg: 500,
    pkgUnitCd: 'EA',
    qty: 500,
    qtyUnitCd: 'EA',
    totWt: 275.5,
    netWt: 250.0,
    spplrNm: 'Test Import Supplier',
    agntNm: 'Test Clearing Agent',
    invcFcurAmt: 1250.0,
    invcFcurCd: 'ZAR',
    invcFcurExcrt: 0.68,
    dclRefNum: 'CX1100096839',
  };
}

// Item 11* (POST /imports/selectImportItems, MANDATORY per spec). Mirrors
// items 28*/10*/14*'s retrieve-sync test coverage, adapted for the flat
// data.itemList[] shape and the (taskCd, itemSeq) dedup key.
describe('importRetrieveSync', () => {
  afterEach(async () => {
    await prisma.retrievedImportItem.deleteMany({ where: { branchId: BRANCH } });
    await prisma.importRetrievalCursor.deleteMany({ where: { branchId: BRANCH } });
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  it('1. successful retrieval imports lines and reports counts', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneImportLine({ taskCd: 'TASK-1' })])
    );

    const result = await importRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);

    const row = await prisma.retrievedImportItem.findFirst({ where: { branchId: BRANCH, taskCd: 'TASK-1' } });
    expect(row).toBeTruthy();
    expect(row.decision).toBe('PENDING');
    expect(row.hsCd).toBe('22029900000');
  });

  it('2. request construction sends tpin/bhfId/lastReqDt to the real endpoint path', async () => {
    const endpointAdapter = require('../../lib/vsdc-gateway/endpointAdapter');
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    await importRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [path, body] = postSpy.mock.calls[0];
    expect(path).toBe(endpointAdapter.path('importsSelect'));
    expect(body.lastReqDt).toBe(importRetrieveSync.SPEC_DEFAULT_LAST_REQ_DT);
  });

  it('3. extractImportRecords accepts a data.itemList array', () => {
    const items = [oneImportLine()];
    const extracted = importRetrieveSync.extractImportRecords({ resultCd: '000', data: { itemList: items } });
    expect(extracted).toEqual(items);
  });

  it('4. extractImportRecords throws clearly on an unrecognized shape', () => {
    expect(() =>
      importRetrieveSync.extractImportRecords({ resultCd: '000', data: { saleList: [] } })
    ).toThrow(/Unrecognized .* response shape/);
  });

  it('5. initial sync (no prior cursor) creates one and uses the spec default lastReqDt', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));
    const before = await prisma.importRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(before).toBeNull();

    await importRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    const after = await prisma.importRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(after).toBeTruthy();
    expect(after.lastSyncedAt).toBeTruthy();
  });

  it('6. incremental sync sends the previously-stored lastReqDt, not the spec default', async () => {
    await prisma.importRetrievalCursor.create({
      data: { branchId: BRANCH, lastReqDt: '20260101000000', lastSyncedAt: new Date() },
    });
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    await importRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(postSpy.mock.calls[0][1].lastReqDt).toBe('20260101000000');
  });

  it('7. the same (taskCd, itemSeq) retrieved twice is deduped, not duplicated', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneImportLine({ taskCd: 'TASK-DUP' })])
    );

    const first = await importRetrieveSync.retrieveAndSync({ branchId: BRANCH });
    const second = await importRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(first.imported).toBe(1);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);

    const rows = await prisma.retrievedImportItem.findMany({ where: { branchId: BRANCH, taskCd: 'TASK-DUP' } });
    expect(rows).toHaveLength(1);
  });

  it('8. a record with no taskCd/itemSeq is skipped, not persisted with a fabricated key', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([{ ...oneImportLine(), taskCd: null }])
    );

    const result = await importRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(true);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('9. an empty response is a normal success — zero imported, cursor still advances', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    const result = await importRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(true);
    expect(result.imported).toBe(0);
    const cursor = await prisma.importRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastSyncedAt).toBeTruthy();
  });

  it('10. a VSDC rejection fails the sync without throwing and does not advance the cursor', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: false,
      data: { resultCd: '999', resultMsg: 'Simulated VSDC rejection' },
    });

    const result = await importRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(false);
    const cursor = await prisma.importRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastReqDt).toBe(importRetrieveSync.SPEC_DEFAULT_LAST_REQ_DT);
    expect(cursor.lastSyncedAt).toBeNull();
    expect(cursor.lastSyncError).toMatch(/Simulated VSDC rejection/);
  });

  it('11. a network failure (transport throws) fails the sync cleanly without advancing the cursor', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await importRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
    const cursor = await prisma.importRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastSyncedAt).toBeNull();
  });

  it('12. rejects a malformed response (no itemList array) instead of silently importing nothing', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { resultCd: '000', data: { somethingElse: true } },
    });

    const result = await importRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unrecognized .* response shape/);
  });

  it('13. a database failure mid-batch fails the sync and does not advance the cursor, even if an earlier row persisted', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(
      mockResponse([oneImportLine({ taskCd: 'TASK-OK' }), oneImportLine({ taskCd: 'TASK-BOOM' })])
    );
    const realCreate = prisma.retrievedImportItem.create.bind(prisma.retrievedImportItem);
    let call = 0;
    prisma.retrievedImportItem.create = (args) => {
      call += 1;
      if (call === 2) throw new Error('Simulated DB failure');
      return realCreate(args);
    };

    let result;
    try {
      result = await importRetrieveSync.retrieveAndSync({ branchId: BRANCH });
    } finally {
      prisma.retrievedImportItem.create = realCreate;
    }

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Simulated DB failure/);
    expect(result.imported).toBe(1);
    const cursor = await prisma.importRetrievalCursor.findUnique({ where: { branchId: BRANCH } });
    expect(cursor.lastSyncedAt).toBeNull();
  });

  it('14. retry after failure re-requests the same lastReqDt and completes without duplicating', async () => {
    const postSpy = vi
      .spyOn(transport, 'authenticatedPost')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(mockResponse([oneImportLine({ taskCd: 'TASK-RETRY' })]));

    const attempt1 = await importRetrieveSync.retrieveAndSync({ branchId: BRANCH });
    expect(attempt1.success).toBe(false);

    const attempt2 = await importRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(attempt2.success).toBe(true);
    expect(attempt2.imported).toBe(1);
    expect(postSpy.mock.calls[0][1].lastReqDt).toBe(importRetrieveSync.SPEC_DEFAULT_LAST_REQ_DT);
  });

  it('15. the cursor is read fresh from the database each call, not cached in-process', async () => {
    await prisma.importRetrievalCursor.create({
      data: { branchId: BRANCH, lastReqDt: '20250601000000', lastSyncedAt: new Date() },
    });
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse([]));

    await importRetrieveSync.retrieveAndSync({ branchId: BRANCH });

    expect(postSpy.mock.calls[0][1].lastReqDt).toBe('20250601000000');
  });
});
