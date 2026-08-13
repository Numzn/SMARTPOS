import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

const prisma = require('../../lib/prisma');
const transport = require('../../lib/vsdc-gateway/transport');
const importDecisionSync = require('../../lib/vsdc-gateway/importDecisionSync');
const stockSyncService = require('../../services/stockSyncService');
const vsdcService = require('../../services/vsdcService.js');
const testData = require('../helpers/testData.js');

const { createTestCategory, createTestProduct, createTestUser, cleanupTestData } = testData;

const BRANCH = 'TEST-IMPORT-DECIDE-BRANCH';

function mockResponse() {
  return { success: true, data: { resultCd: '000', resultMsg: 'It is succeeded', data: null } };
}

async function createRetrievedImportItem(overrides = {}) {
  return prisma.retrievedImportItem.create({
    data: {
      branchId: BRANCH,
      taskCd: `TASK-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      dclDe: '20260801',
      itemSeq: 1,
      hsCd: '22029900000',
      itemNm: 'Test Import Item',
      qty: 10,
      ...overrides,
    },
  });
}

// Item 12* (POST /imports/updateImportItems, MANDATORY per spec). Mirrors
// item 13*'s purchaseSaveSync test coverage, adapted for the per-item
// decide workflow (approve/reject, not a batch "sync all pending" job).
describe('importDecisionSync', () => {
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
    await prisma.retrievedImportItem.deleteMany({ where: { branchId: BRANCH } });
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  it('1. rejects an unknown decision value without touching the DB or network', async () => {
    const item = await createRetrievedImportItem();
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse());

    const result = await importDecisionSync.decideImportItem(item.id, { decision: 'MAYBE', productId: 'x' });

    expect(result.ok).toBe(false);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('2. returns not-found for a missing import item', async () => {
    const result = await importDecisionSync.decideImportItem('does-not-exist', { decision: 'APPROVED', productId: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('3. requires a productId for both APPROVED and REJECTED', async () => {
    const item = await createRetrievedImportItem();
    const approved = await importDecisionSync.decideImportItem(item.id, { decision: 'APPROVED' });
    const rejected = await importDecisionSync.decideImportItem(item.id, { decision: 'REJECTED' });
    expect(approved.ok).toBe(false);
    expect(rejected.ok).toBe(false);
  });

  it('4. APPROVED: submits to VSDC, records the decision, credits stock, and triggers the follow-up sync', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, zraClassificationCode: '50101500' });
    const item = await createRetrievedImportItem({ qty: 25 });
    const user = await createTestUser({ role: 'MANAGER' });
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse());
    const syncSpy = vi.spyOn(stockSyncService, 'syncAfterMovements').mockImplementation(() => {});

    const result = await importDecisionSync.decideImportItem(item.id, {
      decision: 'APPROVED',
      productId: product.id,
      actor: { id: user.id, name: user.email },
    });

    expect(result.ok).toBe(true);
    expect(postSpy).toHaveBeenCalledTimes(1);
    const [, body] = postSpy.mock.calls[0];
    expect(body.importItemList[0].imptItemSttsCd).toBe('3');
    expect(body.importItemList[0].itemCd).toBe(product.sku);

    const refreshed = await prisma.retrievedImportItem.findUnique({ where: { id: item.id } });
    expect(refreshed.decision).toBe('APPROVED');
    expect(refreshed.decidedProductId).toBe(product.id);
    expect(refreshed.zraDecisionSyncedAt).toBeTruthy();

    const movement = await prisma.stockMovement.findFirst({
      where: { referenceType: 'IMPORT_ITEM', referenceId: item.id },
    });
    expect(movement).toBeTruthy();
    expect(movement.movementType).toBe('IMPORT_IN');
    expect(movement.quantity).toBe(25);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: BRANCH } },
    });
    expect(inventory.currentStock).toBe(25);

    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(syncSpy.mock.calls[0][0]).toContain(movement.id);
  });

  it('5. REJECTED: submits to VSDC, records the decision, and has no stock effect', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, zraClassificationCode: '50101500' });
    const item = await createRetrievedImportItem();
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse());
    const syncSpy = vi.spyOn(stockSyncService, 'syncAfterMovements').mockImplementation(() => {});

    const result = await importDecisionSync.decideImportItem(item.id, {
      decision: 'REJECTED',
      productId: product.id,
      remark: 'not ours',
    });

    expect(result.ok).toBe(true);
    const [, body] = postSpy.mock.calls[0];
    expect(body.importItemList[0].imptItemSttsCd).toBe('4');
    expect(body.importItemList[0].remark).toBe('not ours');

    const refreshed = await prisma.retrievedImportItem.findUnique({ where: { id: item.id } });
    expect(refreshed.decision).toBe('REJECTED');

    const movement = await prisma.stockMovement.findFirst({
      where: { referenceType: 'IMPORT_ITEM', referenceId: item.id },
    });
    expect(movement).toBeNull();
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('6. a VSDC failure leaves the item PENDING, not falsely decided', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, zraClassificationCode: '50101500' });
    const item = await createRetrievedImportItem();
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: false,
      data: { resultCd: '999', resultMsg: 'Simulated VSDC rejection' },
    });

    const result = await importDecisionSync.decideImportItem(item.id, { decision: 'APPROVED', productId: product.id });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Simulated VSDC rejection/);
    const refreshed = await prisma.retrievedImportItem.findUnique({ where: { id: item.id } });
    expect(refreshed.decision).toBe('PENDING');
  });

  it('7. an already-decided item is skipped, not re-submitted', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, zraClassificationCode: '50101500' });
    const item = await createRetrievedImportItem();
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockResponse());

    await importDecisionSync.decideImportItem(item.id, { decision: 'APPROVED', productId: product.id });
    const second = await importDecisionSync.decideImportItem(item.id, { decision: 'APPROVED', productId: product.id });

    expect(second.ok).toBe(true);
    expect(second.skipped).toBe(true);
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('8. an unknown productId fails cleanly', async () => {
    const item = await createRetrievedImportItem();
    const result = await importDecisionSync.decideImportItem(item.id, { decision: 'APPROVED', productId: 'nope' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Product not found/);
  });
});
