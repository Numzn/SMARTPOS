import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestBranch, createTestUser, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

const vsdcRouter = require('../../routes/vsdc.js');
const vsdcGateway = require('../../lib/vsdc-gateway');
const vsdcService = require('../../services/vsdcService.js');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

const BRANCH = 'TEST-ROUTE-PURCHASES';

// Items 13*/14* route-level coverage — permission gates, response surface.
describe('POST /api/vsdc/purchases/sync, POST /api/vsdc/purchases/retrieve, GET /api/vsdc/purchases/retrieve/status', () => {
  const app = createTestApp('/api/vsdc', vsdcRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await prisma.purchaseRetrievalCursor.deleteMany({ where: { branchId: BRANCH } });
    await prisma.retrievedPurchase.deleteMany({ where: { branchId: BRANCH } });
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  it('POST /purchases/sync is gated behind zra:sync — a cashier is forbidden', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });

    const res = await request(app)
      .post('/api/vsdc/purchases/sync')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ branchId: BRANCH });

    expect(res.status).toBe(403);
  });

  it('POST /purchases/retrieve is gated behind zra:sync — a cashier is forbidden', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });

    const res = await request(app)
      .post('/api/vsdc/purchases/retrieve')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ branchId: BRANCH });

    expect(res.status).toBe(403);
  });

  it('GET /purchases/retrieve/status is gated behind zra:read', async () => {
    const res = await request(app).get(`/api/vsdc/purchases/retrieve/status?branchId=${BRANCH}`);
    expect(res.status).toBe(401);
  });

  it('a successful purchase sync returns attempted/succeeded/failed counts', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    vi.spyOn(vsdcGateway, 'ensureReady').mockResolvedValue({ success: true });
    vi.spyOn(vsdcGateway, 'submitPurchases').mockResolvedValue({
      attempted: 2,
      succeeded: 2,
      failed: 0,
      items: [],
    });

    const res = await request(app)
      .post('/api/vsdc/purchases/sync')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ branchId: BRANCH });

    expect(res.status).toBe(200);
    expect(res.body.attempted).toBe(2);
    expect(res.body.succeeded).toBe(2);
  });

  it('a successful purchase retrieve returns imported/skipped counts', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    vi.spyOn(vsdcGateway, 'ensureReady').mockResolvedValue({ success: true });
    vi.spyOn(vsdcGateway, 'retrievePurchases').mockResolvedValue({
      success: true,
      imported: 2,
      skipped: 0,
    });

    const res = await request(app)
      .post('/api/vsdc/purchases/retrieve')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ branchId: BRANCH });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
  });

  it('a failed purchase retrieve surfaces as 502, not a silent 200', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    vi.spyOn(vsdcGateway, 'ensureReady').mockResolvedValue({ success: true });
    vi.spyOn(vsdcGateway, 'retrievePurchases').mockResolvedValue({
      success: false,
      error: 'Simulated failure',
      imported: 0,
      skipped: 0,
    });

    const res = await request(app)
      .post('/api/vsdc/purchases/retrieve')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ branchId: BRANCH });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Simulated failure/);
  });

  it('status reflects "never synced" before any retrieve has run', async () => {
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .get(`/api/vsdc/purchases/retrieve/status?branchId=${BRANCH}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.everSynced).toBe(false);
    expect(res.body.lastReqDt).toBeNull();
  });

  it('a real retrieve run persists RetrievedPurchase rows and status reflects it, calling twice is idempotent', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    vi.spyOn(vsdcService, 'ensureDeviceInitialized').mockResolvedValue({ success: true });
    const purchaseRetrieveSync = require('../../lib/vsdc-gateway/purchaseRetrieveSync');
    const transport = require('../../lib/vsdc-gateway/transport');
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: {
        resultCd: '000',
        data: {
          saleList: [
            {
              spplrTpin: '2000000000',
              spplrBhfId: '000',
              spplrInvcNo: '8001',
              totAmt: 10,
              itemList: [{ itemSeq: 1, itemCd: 'COKE500', qty: 1, prc: 10, totAmt: 10 }],
            },
          ],
        },
      },
    });

    await request(app)
      .post('/api/vsdc/purchases/retrieve')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ branchId: BRANCH });

    const statusRes = await request(app)
      .get(`/api/vsdc/purchases/retrieve/status?branchId=${BRANCH}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(statusRes.body.everSynced).toBe(true);
    expect(statusRes.body.lastReqDt).not.toBe(purchaseRetrieveSync.SPEC_DEFAULT_LAST_REQ_DT);

    const secondRes = await request(app)
      .post('/api/vsdc/purchases/retrieve')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ branchId: BRANCH });

    expect(secondRes.body.imported).toBe(0);
    expect(secondRes.body.skipped).toBe(1);
  });
});
