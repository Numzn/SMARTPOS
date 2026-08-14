import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

const prisma = require('../../lib/prisma');
const transport = require('../../lib/vsdc-gateway/transport');
const purchaseSaveSync = require('../../lib/vsdc-gateway/purchaseSaveSync');
const stockSyncService = require('../../services/stockSyncService');
const vsdcService = require('../../services/vsdcService.js');
const testData = require('../helpers/testData.js');

const { createTestSupplier, createTestCategory, createTestProduct, createTestGoodsReceivedNote, cleanupTestData } = testData;

function mockResponse(overrides = {}) {
  return { success: true, data: { resultCd: '000', resultMsg: 'It is succeeded', data: null, ...overrides } };
}

async function setupGrn({ withStockMovements = false } = {}) {
  const supplier = await createTestSupplier({ tpin: '2000000000' });
  const category = await createTestCategory();
  const product = await createTestProduct({
    categoryId: category.id,
    zraClassificationCode: '50101500',
  });
  const grn = await createTestGoodsReceivedNote({
    supplierId: supplier.id,
    items: [{ productId: product.id, quantityReceived: 3, unitCost: 12 }],
    withStockMovements,
  });
  return { supplier, product, grn };
}

// Item 13* (POST /trnsPurchase/savePurchase, MANDATORY per spec). Mirrors
// stockSyncService's push-pattern test coverage.
describe('purchaseSaveSync', () => {
  let originalTpin;
  let originalBhfId;

  beforeAll(() => {
    originalTpin = vsdcService.tpin;
    originalBhfId = vsdcService.bhfId;
    vsdcService.tpin = 'TEST-TPIN';
    vsdcService.bhfId = '000';
  });

  afterAll(() => {
    vsdcService.tpin = originalTpin;
    vsdcService.bhfId = originalBhfId;
  });

  afterEach(async () => {
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  it('1. getPendingGrns returns only unsynced GRNs', async () => {
    const { grn } = await setupGrn();
    const pending = await purchaseSaveSync.getPendingGrns({ branchId: grn.branchId });
    expect(pending.some((g) => g.id === grn.id)).toBe(true);
  });

  it('2. successful sync marks the GRN synced and records the VSDC response', async () => {
    const { grn } = await setupGrn();
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse());

    const result = await purchaseSaveSync.syncGrnById(grn.id);

    expect(result.ok).toBe(true);
    const refreshed = await prisma.goodsReceivedNote.findUnique({ where: { id: grn.id } });
    expect(refreshed.zraSyncedAt).toBeTruthy();
    expect(refreshed.zraSyncError).toBeNull();
    expect(refreshed.zraSyncResponse).toBeTruthy();
  });

  it('3. request construction sends the correct fixed codes to the real endpoint path', async () => {
    const endpointAdapter = require('../../lib/vsdc-gateway/endpointAdapter');
    const { grn } = await setupGrn();
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse());

    await purchaseSaveSync.syncGrnById(grn.id);

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [path, body] = postSpy.mock.calls[0];
    expect(path).toBe(endpointAdapter.path('purchaseSave'));
    expect(body.regTyCd).toBe('M');
    expect(body.cisInvcNo).toBe(grn.grnNumber);
  });

  it('4. a VSDC failure marks the GRN failed without marking it synced', async () => {
    const { grn } = await setupGrn();
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: false,
      data: { resultCd: '999', resultMsg: 'Simulated VSDC rejection' },
    });

    const result = await purchaseSaveSync.syncGrnById(grn.id);

    expect(result.ok).toBe(false);
    const refreshed = await prisma.goodsReceivedNote.findUnique({ where: { id: grn.id } });
    expect(refreshed.zraSyncedAt).toBeNull();
    expect(refreshed.zraSyncError).toMatch(/Simulated VSDC rejection/);
  });

  it('5. a network failure (transport throws) marks the GRN failed cleanly', async () => {
    const { grn } = await setupGrn();
    vi.spyOn(transport, 'authenticatedPost').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await purchaseSaveSync.syncGrnById(grn.id);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it('6. an already-synced GRN is skipped, not re-submitted', async () => {
    const { grn } = await setupGrn();
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse());

    await purchaseSaveSync.syncGrnById(grn.id);
    const second = await purchaseSaveSync.syncGrnById(grn.id);

    expect(second.ok).toBe(true);
    expect(second.skipped).toBe(true);
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('7. validation failure (empty itemList) fails without any network call', async () => {
    const supplier = await createTestSupplier({ tpin: '2000000000' });
    const grn = await prisma.goodsReceivedNote.create({
      data: { grnNumber: 'TEST-GRN-EMPTY', supplierId: supplier.id, branchId: 'main' },
    });
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse());

    const result = await purchaseSaveSync.syncGrnById(grn.id);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/itemList/);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('8. a successful purchase sync triggers the stock-push follow-up for the GRN\'s unsynced movements', async () => {
    const { grn } = await setupGrn({ withStockMovements: true });
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse());
    const syncSpy = vi.spyOn(stockSyncService, 'syncAfterMovements').mockImplementation(() => {});

    await purchaseSaveSync.syncGrnById(grn.id);

    expect(syncSpy).toHaveBeenCalledTimes(1);
    const [movementIds, branchId] = syncSpy.mock.calls[0];
    expect(movementIds.length).toBeGreaterThan(0);
    expect(branchId).toBe(grn.branchId);
  });

  it('9. a failed purchase submission does NOT trigger the stock-push follow-up', async () => {
    const { grn } = await setupGrn({ withStockMovements: true });
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: false,
      data: { resultCd: '999', resultMsg: 'Simulated failure' },
    });
    const syncSpy = vi.spyOn(stockSyncService, 'syncAfterMovements').mockImplementation(() => {});

    await purchaseSaveSync.syncGrnById(grn.id);

    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('10. already-synced movements are excluded from the stock-push follow-up call', async () => {
    const { grn } = await setupGrn({ withStockMovements: true });
    await prisma.stockMovement.updateMany({
      where: { referenceType: 'PURCHASE_ORDER', referenceId: grn.id },
      data: { zraSyncedAt: new Date() },
    });
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse());
    const syncSpy = vi.spyOn(stockSyncService, 'syncAfterMovements').mockImplementation(() => {});

    await purchaseSaveSync.syncGrnById(grn.id);

    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('11. syncPendingGrns aggregates succeeded/failed/attempted correctly across a mixed batch', async () => {
    const { grn: grnOk } = await setupGrn();
    const { grn: grnFail } = await setupGrn();
    let call = 0;
    vi.spyOn(transport, 'authenticatedPost').mockImplementation(async () => {
      call += 1;
      if (call === 1) return mockResponse();
      return { success: false, data: { resultCd: '999', resultMsg: 'Simulated failure' } };
    });

    const result = await purchaseSaveSync.syncPendingGrns({ branchId: grnOk.branchId, limit: 10 });

    expect(result.attempted).toBeGreaterThanOrEqual(2);
    expect(result.succeeded + result.failed).toBe(result.attempted);
  });

  it('12. getPendingGrns respects the limit option', async () => {
    await setupGrn();
    await setupGrn();
    const pending = await purchaseSaveSync.getPendingGrns({ limit: 1 });
    expect(pending.length).toBeLessThanOrEqual(1);
  });

  // Item 15* — syncAfterReceive is the fire-and-forget wrapper routes/purchaseOrders.js
  // calls after a receive transaction commits. It never returns a promise
  // (matching stockSyncService.syncAfterSale/syncAfterMovements exactly), so
  // these tests observe its effect via the DB rather than awaiting it directly.
  describe('syncAfterReceive (item 15*)', () => {
    it('13. fires syncGrnById in the background and it completes successfully', async () => {
      const { grn } = await setupGrn();
      const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse());

      purchaseSaveSync.syncAfterReceive(grn.id);

      await vi.waitFor(async () => {
        const refreshed = await prisma.goodsReceivedNote.findUnique({ where: { id: grn.id } });
        expect(refreshed.zraSyncedAt).toBeTruthy();
      });
      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    it('14. a VSDC failure leaves the GRN pending (zraSyncedAt null) with the error recorded, not lost', async () => {
      const { grn } = await setupGrn();
      vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
        success: false,
        data: { resultCd: '999', resultMsg: 'Simulated VSDC outage' },
      });

      purchaseSaveSync.syncAfterReceive(grn.id);

      await vi.waitFor(async () => {
        const refreshed = await prisma.goodsReceivedNote.findUnique({ where: { id: grn.id } });
        expect(refreshed.zraSyncError).toMatch(/Simulated VSDC outage/);
      });
      const refreshed = await prisma.goodsReceivedNote.findUnique({ where: { id: grn.id } });
      expect(refreshed.zraSyncedAt).toBeNull();
    });

    it('15. never throws synchronously and logs a warning if the underlying sync rejects unexpectedly', async () => {
      // A real, unmocked Prisma failure (not a stub) — id:null fails Prisma's
      // own query validation for a non-nullable String field, exercising the
      // actual exception path syncGrnById doesn't wrap in its own try/catch.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => purchaseSaveSync.syncAfterReceive(null)).not.toThrow();

      await vi.waitFor(() => {
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toBe('[purchaseSaveSync] post-receive sync failed:');
      });
    });

    it('16. calling it twice for the same GRN (duplicate trigger) only submits once — the second call is skipped', async () => {
      const { grn } = await setupGrn();
      const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse());

      purchaseSaveSync.syncAfterReceive(grn.id);
      await vi.waitFor(async () => {
        const refreshed = await prisma.goodsReceivedNote.findUnique({ where: { id: grn.id } });
        expect(refreshed.zraSyncedAt).toBeTruthy();
      });

      // A second trigger for the same GRN — e.g. a duplicated route call, or
      // an operator also clicking manual sync after the automatic one landed.
      purchaseSaveSync.syncAfterReceive(grn.id);
      await new Promise((resolve) => setImmediate(resolve));

      expect(postSpy).toHaveBeenCalledTimes(1);
    });
  });
});
