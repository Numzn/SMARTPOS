import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import purchaseOrdersRouter from '../../routes/purchaseOrders.js';
import vsdcRouter from '../../routes/vsdc.js';

const {
  createTestBranch,
  createTestUser,
  createTestSupplier,
  createTestProduct,
  createTestPurchaseOrder,
  cleanupTestData,
  prisma,
  DEFAULT_BRANCH_CODE,
} = testData;
const { createTestApp } = testApp;

const transport = require('../../lib/vsdc-gateway/transport');
const vsdcGateway = require('../../lib/vsdc-gateway');
const endpointAdapter = require('../../lib/vsdc-gateway/endpointAdapter');
const vsdcService = require('../../services/vsdcService.js');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

function mockVsdcResponse(overrides = {}) {
  return { success: true, data: { resultCd: '000', resultMsg: 'It is succeeded', data: null, ...overrides } };
}

async function setupSentPo() {
  const supplier = await createTestSupplier({ tpin: '2000000000' });
  const product = await createTestProduct({ zraClassificationCode: '50101500' });
  const po = await createTestPurchaseOrder({
    supplierId: supplier.id,
    items: [{ productId: product.id, quantity: 10, unitCost: 20 }],
    status: 'SENT',
  });
  return { supplier, product, po };
}

async function grnForPo(poId) {
  return prisma.goodsReceivedNote.findFirst({ where: { purchaseOrderId: poId } });
}

// Item 15* — GRN receiving (POST /api/purchase-orders/:id/receive) automatically
// fires fiscal purchase reporting (the same engine POST /api/vsdc/purchases/sync
// uses manually), so an operator no longer has to remember the second call.
describe('POST /api/purchase-orders/:id/receive — automatic fiscal purchase reporting (item 15*)', () => {
  const poApp = createTestApp('/api/purchase-orders', purchaseOrdersRouter);
  const vsdcApp = createTestApp('/api/vsdc', vsdcRouter);
  let originalTpin;
  let originalBhfId;

  beforeAll(async () => {
    await createTestBranch();
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

  it('happy path: a successful receive automatically syncs the new GRN to VSDC with no second call', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const { po } = await setupSentPo();
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockVsdcResponse());

    const res = await request(poApp)
      .post(`/api/purchase-orders/${po.id}/receive`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ items: [{ purchaseOrderItemId: po.items[0].id, quantity: 10 }] });

    expect(res.status).toBe(201);
    expect(res.body.grn.grnNumber).toMatch(/^GRN-/);

    // The auto-trigger is fire-and-forget — the HTTP response above does not
    // wait for it, so poll briefly for the background sync to land.
    await vi.waitFor(async () => {
      const grn = await grnForPo(po.id);
      expect(grn.zraSyncedAt).toBeTruthy();
    });

    const grn = await grnForPo(po.id);
    expect(grn.zraSyncError).toBeNull();
    // Filter to the purchase-save call specifically — a successful purchase
    // sync also fires the pre-existing stock-push follow-up (items 27*/29*)
    // for the GRN's stock movement, which is a separate, additional call
    // through this same authenticatedPost spy and not part of what item 15*
    // is verifying here.
    const purchaseSaveCalls = postSpy.mock.calls.filter(([path]) => path === endpointAdapter.path('purchaseSave'));
    expect(purchaseSaveCalls).toHaveLength(1);
    expect(purchaseSaveCalls[0][1].cisInvcNo).toBe(grn.grnNumber);
  });

  it('VSDC failure: the GRN and stock receipt are NOT lost or rolled back, and the failure is recorded, not silent', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const { po, product } = await setupSentPo();
    vi.spyOn(transport, 'authenticatedPost').mockRejectedValue(new Error('getaddrinfo EAI_AGAIN mock-vsdc'));

    const res = await request(poApp)
      .post(`/api/purchase-orders/${po.id}/receive`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ items: [{ purchaseOrderItemId: po.items[0].id, quantity: 10 }] });

    // The receive itself succeeds regardless of VSDC's availability.
    expect(res.status).toBe(201);
    expect(res.body.purchaseOrder.status).toBe('RECEIVED');

    const inventory = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(inventory.currentStock).toBe(10);

    await vi.waitFor(async () => {
      const grn = await grnForPo(po.id);
      expect(grn.zraSyncError).toMatch(/EAI_AGAIN/);
    });

    const grn = await grnForPo(po.id);
    // Pending, not synced — this is the same "unsynced" sentinel the manual
    // endpoint's getPendingGrns() scans for, so it stays retryable.
    expect(grn.zraSyncedAt).toBeNull();
  });

  it('retry: a GRN whose automatic sync failed can be recovered through the existing manual endpoint', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const { po } = await setupSentPo();
    vi.spyOn(transport, 'authenticatedPost').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await request(poApp)
      .post(`/api/purchase-orders/${po.id}/receive`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ items: [{ purchaseOrderItemId: po.items[0].id, quantity: 10 }] });

    await vi.waitFor(async () => {
      const grn = await grnForPo(po.id);
      expect(grn.zraSyncError).toMatch(/ECONNREFUSED/);
    });

    // VSDC is back up — the operator falls back to the pre-existing manual
    // sync endpoint, exactly as they would have before this feature existed.
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockVsdcResponse());
    vi.spyOn(vsdcGateway, 'ensureReady').mockResolvedValue({ success: true });

    const retryRes = await request(vsdcApp)
      .post('/api/vsdc/purchases/sync')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ branchId: DEFAULT_BRANCH_CODE });

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.succeeded).toBeGreaterThanOrEqual(1);

    const grn = await grnForPo(po.id);
    expect(grn.zraSyncedAt).toBeTruthy();
    expect(grn.zraSyncError).toBeNull();
  });

  it('idempotency: the automatic trigger and a concurrent manual sync of the same GRN do not double-submit', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const { po } = await setupSentPo();
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue(mockVsdcResponse());

    await request(poApp)
      .post(`/api/purchase-orders/${po.id}/receive`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ items: [{ purchaseOrderItemId: po.items[0].id, quantity: 10 }] });

    await vi.waitFor(async () => {
      const grn = await grnForPo(po.id);
      expect(grn.zraSyncedAt).toBeTruthy();
    });

    // A manual sync run after the automatic one already landed — the same
    // situation an operator hits if they don't realize receiving is now
    // automatic and click "Sync Purchases" out of habit.
    vi.spyOn(vsdcGateway, 'ensureReady').mockResolvedValue({ success: true });
    const secondRes = await request(vsdcApp)
      .post('/api/vsdc/purchases/sync')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ branchId: DEFAULT_BRANCH_CODE });

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.attempted).toBe(0); // already-synced GRN isn't even picked up as pending
    // Same stock-push-follow-up caveat as the happy-path test above — filter
    // to purchase-save calls specifically rather than the spy's raw total.
    const purchaseSaveCalls = postSpy.mock.calls.filter(([path]) => path === endpointAdapter.path('purchaseSave'));
    expect(purchaseSaveCalls).toHaveLength(1); // still just the one real submission
  });

  it('regression: existing receive behavior (stock, batch, PO status) is unchanged when VSDC is unreachable', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const { po, product } = await setupSentPo();
    vi.spyOn(transport, 'authenticatedPost').mockRejectedValue(new Error('unreachable'));

    const res = await request(poApp)
      .post(`/api/purchase-orders/${po.id}/receive`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ items: [{ purchaseOrderItemId: po.items[0].id, quantity: 4 }] });

    expect(res.status).toBe(201);
    expect(res.body.purchaseOrder.status).toBe('PARTIALLY_RECEIVED');
    expect(res.body.purchaseOrder.items[0].quantityReceived).toBe(4);
    expect(res.body.grn.items[0].quantityReceived).toBe(4);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(inventory.currentStock).toBe(4);
  });
});
