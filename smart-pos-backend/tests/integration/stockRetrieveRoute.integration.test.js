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

const BRANCH = 'TEST-ROUTE-RETRIEVE';

// Item 28* route-level coverage — permission gates, response surface,
// distinct from POST /api/vsdc/stock/sync (the opposite, push direction).
describe('POST /api/vsdc/stock/retrieve, GET /api/vsdc/stock/retrieve/status', () => {
  const app = createTestApp('/api/vsdc', vsdcRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await prisma.stockRetrievalCursor.deleteMany({ where: { branchId: BRANCH } });
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  it('POST /stock/retrieve is gated behind zra:sync — a cashier is forbidden', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });

    const res = await request(app)
      .post('/api/vsdc/stock/retrieve')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ branchId: BRANCH });

    expect(res.status).toBe(403);
  });

  it('GET /stock/retrieve/status is gated behind zra:read', async () => {
    const res = await request(app).get(`/api/vsdc/stock/retrieve/status?branchId=${BRANCH}`);
    expect(res.status).toBe(401);
  });

  it('a successful retrieve returns imported/skipped/unmatched counts', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    vi.spyOn(vsdcGateway, 'ensureReady').mockResolvedValue({ success: true });
    vi.spyOn(vsdcGateway, 'retrieveStockItems').mockResolvedValue({
      success: true,
      imported: 2,
      skipped: 1,
      unmatched: 0,
      unmatchedItemCodes: [],
    });

    const res = await request(app)
      .post('/api/vsdc/stock/retrieve')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ branchId: BRANCH });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.skipped).toBe(1);
  });

  it('a failed retrieve surfaces as 502, not a silent 200', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    vi.spyOn(vsdcGateway, 'ensureReady').mockResolvedValue({ success: true });
    vi.spyOn(vsdcGateway, 'retrieveStockItems').mockResolvedValue({
      success: false,
      error: 'Simulated failure',
      imported: 0,
      skipped: 0,
      unmatched: 0,
    });

    const res = await request(app)
      .post('/api/vsdc/stock/retrieve')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ branchId: BRANCH });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Simulated failure/);
  });

  it('status reflects "never synced" before any retrieve has run', async () => {
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .get(`/api/vsdc/stock/retrieve/status?branchId=${BRANCH}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.everSynced).toBe(false);
    expect(res.body.lastReqDt).toBeNull();
  });

  it('status reflects the persisted cursor after a real sync (not the gateway mock)', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    vi.spyOn(vsdcService, 'ensureDeviceInitialized').mockResolvedValue({ success: true });
    const stockRetrieveSync = require('../../lib/vsdc-gateway/stockRetrieveSync');
    const transport = require('../../lib/vsdc-gateway/transport');
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { resultCd: '000', data: { stockList: [] } },
    });

    await request(app)
      .post('/api/vsdc/stock/retrieve')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ branchId: BRANCH });

    const res = await request(app)
      .get(`/api/vsdc/stock/retrieve/status?branchId=${BRANCH}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.body.everSynced).toBe(true);
    // A successful sync advances the cursor past the initial default —
    // that's the whole point of it being a cursor.
    expect(res.body.lastReqDt).not.toBe(stockRetrieveSync.SPEC_DEFAULT_LAST_REQ_DT);
    expect(res.body.lastReqDt).toMatch(/^\d{14}$/);
  });
});
