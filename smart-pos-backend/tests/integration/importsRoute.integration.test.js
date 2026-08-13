import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestBranch, createTestUser, createTestCategory, createTestProduct, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

const vsdcRouter = require('../../routes/vsdc.js');
const vsdcGateway = require('../../lib/vsdc-gateway');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

const BRANCH = 'TEST-ROUTE-IMPORTS';

async function createRetrievedImportItem() {
  return prisma.retrievedImportItem.create({
    data: {
      branchId: BRANCH,
      taskCd: `TASK-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      dclDe: '20260801',
      itemSeq: 1,
      hsCd: '22029900000',
      itemNm: 'Test Import Item',
      qty: 10,
    },
  });
}

// Items 11*/12* route-level coverage — permission gates, response surface.
describe('POST /api/vsdc/imports/retrieve, GET /api/vsdc/imports, POST /api/vsdc/imports/:id/decide', () => {
  const app = createTestApp('/api/vsdc', vsdcRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await prisma.retrievedImportItem.deleteMany({ where: { branchId: BRANCH } });
    await prisma.importRetrievalCursor.deleteMany({ where: { branchId: BRANCH } });
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  it('POST /imports/retrieve is gated behind zra:sync — a cashier is forbidden', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });

    const res = await request(app)
      .post('/api/vsdc/imports/retrieve')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ branchId: BRANCH });

    expect(res.status).toBe(403);
  });

  it('GET /imports/retrieve/status is gated behind zra:read', async () => {
    const res = await request(app).get(`/api/vsdc/imports/retrieve/status?branchId=${BRANCH}`);
    expect(res.status).toBe(401);
  });

  it('GET /imports is gated behind zra:read', async () => {
    const res = await request(app).get('/api/vsdc/imports');
    expect(res.status).toBe(401);
  });

  it('POST /imports/:id/decide is gated behind zra:sync — a cashier is forbidden', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const item = await createRetrievedImportItem();

    const res = await request(app)
      .post(`/api/vsdc/imports/${item.id}/decide`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ decision: 'APPROVED', productId: 'x' });

    expect(res.status).toBe(403);
  });

  it('a successful retrieve returns imported/skipped counts', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    vi.spyOn(vsdcGateway, 'ensureReady').mockResolvedValue({ success: true });
    vi.spyOn(vsdcGateway, 'retrieveImports').mockResolvedValue({ success: true, imported: 2, skipped: 0 });

    const res = await request(app)
      .post('/api/vsdc/imports/retrieve')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ branchId: BRANCH });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
  });

  it('a failed retrieve surfaces as 502, not a silent 200', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    vi.spyOn(vsdcGateway, 'ensureReady').mockResolvedValue({ success: true });
    vi.spyOn(vsdcGateway, 'retrieveImports').mockResolvedValue({ success: false, error: 'Simulated failure', imported: 0, skipped: 0 });

    const res = await request(app)
      .post('/api/vsdc/imports/retrieve')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ branchId: BRANCH });

    expect(res.status).toBe(502);
  });

  it('status reflects "never synced" before any retrieve has run', async () => {
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .get(`/api/vsdc/imports/retrieve/status?branchId=${BRANCH}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.everSynced).toBe(false);
  });

  it('GET /imports lists retrieved items and supports ?decision= filtering', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    await createRetrievedImportItem();
    await prisma.retrievedImportItem.create({
      data: {
        branchId: BRANCH,
        taskCd: `TASK-DECIDED-${Date.now()}`,
        itemSeq: 1,
        decision: 'APPROVED',
      },
    });

    const all = await request(app).get(`/api/vsdc/imports?branchId=${BRANCH}`).set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(all.body.total).toBe(2);

    const pendingOnly = await request(app)
      .get(`/api/vsdc/imports?branchId=${BRANCH}&decision=PENDING`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(pendingOnly.body.total).toBe(1);
  });

  it('a successful APPROVED decide credits stock and returns the recorded decision', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, zraClassificationCode: '50101500' });
    const item = await createRetrievedImportItem();
    vi.spyOn(vsdcGateway, 'ensureReady').mockResolvedValue({ success: true });
    vi.spyOn(vsdcGateway, 'decideImportItem').mockResolvedValue({ ok: true, importItemId: item.id, decision: 'APPROVED' });

    const res = await request(app)
      .post(`/api/vsdc/imports/${item.id}/decide`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ decision: 'APPROVED', productId: product.id });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('APPROVED');
  });

  it('a failed decide (e.g. missing productId) surfaces as 400, not a silent 200', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    const item = await createRetrievedImportItem();
    vi.spyOn(vsdcGateway, 'ensureReady').mockResolvedValue({ success: true });
    vi.spyOn(vsdcGateway, 'decideImportItem').mockResolvedValue({ ok: false, error: 'productId is required' });

    const res = await request(app)
      .post(`/api/vsdc/imports/${item.id}/decide`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ decision: 'APPROVED' });

    expect(res.status).toBe(400);
  });

  it('deciding a nonexistent import item surfaces as 404', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    vi.spyOn(vsdcGateway, 'ensureReady').mockResolvedValue({ success: true });
    vi.spyOn(vsdcGateway, 'decideImportItem').mockResolvedValue({ ok: false, error: 'Import item not found' });

    const res = await request(app)
      .post('/api/vsdc/imports/does-not-exist/decide')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ decision: 'APPROVED', productId: 'x' });

    expect(res.status).toBe(404);
  });
});
