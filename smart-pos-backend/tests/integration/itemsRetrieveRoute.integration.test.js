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

const BRANCH = 'TEST-ROUTE-ITEMS-RETRIEVE';

// Item 10* route-level coverage — permission gates, response surface,
// mirrors item 28*'s stockRetrieveRoute.integration.test.js.
describe('POST /api/vsdc/items/retrieve, GET /api/vsdc/items/retrieve/status', () => {
  const app = createTestApp('/api/vsdc', vsdcRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await prisma.itemRetrievalCursor.deleteMany({ where: { branchId: BRANCH } });
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  it('POST /items/retrieve is gated behind zra:sync — a cashier is forbidden', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });

    const res = await request(app)
      .post('/api/vsdc/items/retrieve')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ branchId: BRANCH });

    expect(res.status).toBe(403);
  });

  it('GET /items/retrieve/status is gated behind zra:read', async () => {
    const res = await request(app).get(`/api/vsdc/items/retrieve/status?branchId=${BRANCH}`);
    expect(res.status).toBe(401);
  });

  it('a successful retrieve returns updated/unmatched counts', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    vi.spyOn(vsdcGateway, 'ensureReady').mockResolvedValue({ success: true });
    vi.spyOn(vsdcGateway, 'retrieveItems').mockResolvedValue({
      success: true,
      updated: 2,
      unmatched: 1,
      unmatchedItemCodes: ['SKU-X'],
    });

    const res = await request(app)
      .post('/api/vsdc/items/retrieve')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ branchId: BRANCH });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(res.body.unmatched).toBe(1);
  });

  it('a failed retrieve surfaces as 502, not a silent 200', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    vi.spyOn(vsdcGateway, 'ensureReady').mockResolvedValue({ success: true });
    vi.spyOn(vsdcGateway, 'retrieveItems').mockResolvedValue({
      success: false,
      error: 'Simulated failure',
      updated: 0,
      unmatched: 0,
      unmatchedItemCodes: [],
    });

    const res = await request(app)
      .post('/api/vsdc/items/retrieve')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ branchId: BRANCH });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Simulated failure/);
  });

  it('status reflects "never synced" before any retrieve has run', async () => {
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .get(`/api/vsdc/items/retrieve/status?branchId=${BRANCH}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.everSynced).toBe(false);
    expect(res.body.lastReqDt).toBeNull();
  });

  it('status reflects the persisted cursor after a real sync (not the gateway mock)', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    vi.spyOn(vsdcService, 'ensureDeviceInitialized').mockResolvedValue({ success: true });
    const itemsRetrieveSync = require('../../lib/vsdc-gateway/itemsRetrieveSync');
    const transport = require('../../lib/vsdc-gateway/transport');
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { resultCd: '000', data: { itemList: [] } },
    });

    await request(app)
      .post('/api/vsdc/items/retrieve')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ branchId: BRANCH });

    const res = await request(app)
      .get(`/api/vsdc/items/retrieve/status?branchId=${BRANCH}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.body.everSynced).toBe(true);
    // A successful sync advances the cursor past the initial default —
    // that's the whole point of it being a cursor.
    expect(res.body.lastReqDt).not.toBe(itemsRetrieveSync.SPEC_DEFAULT_LAST_REQ_DT);
    expect(res.body.lastReqDt).toMatch(/^\d{14}$/);
  });
});
