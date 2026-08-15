import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestBranch, createTestUser, createTestCategory, createTestProduct, cleanupTestData, prisma } =
  testData;
const { createTestApp } = testApp;

const productsRouter = require('../../routes/products.js');
const itemManagementService = require('../../services/itemManagement.js');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

// POST /api/products/bulk-register — best-effort registration for every
// PENDING/FAILED product that already has a classification code (see
// lib/productImport.js's parallel best-effort path for the import case).
// This is the standalone endpoint for products that already exist —
// backfilled via CSV re-import or a manual edit.
describe('POST /api/products/bulk-register', () => {
  const app = createTestApp('/api/products', productsRouter);
  const BASE_CLASS_CODE = 'PBR-BASE-CLASS';

  beforeAll(async () => {
    await createTestBranch();
    await prisma.zraClassificationCode.upsert({
      where: { code: BASE_CLASS_CODE },
      create: { code: BASE_CLASS_CODE, name: 'Base classification for bulk-register tests', useYn: 'Y' },
      update: { useYn: 'Y' },
    });
  });

  afterEach(async () => {
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  async function pendingProductWithCode(overrides = {}) {
    const category = await createTestCategory();
    return createTestProduct({
      categoryId: category.id,
      zraClassificationCode: BASE_CLASS_CODE,
      zraItemClassification: BASE_CLASS_CODE,
      zraRegistrationStatus: 'PENDING',
      ...overrides,
    });
  }

  it('is gated behind products:write — a viewer is forbidden', async () => {
    const viewer = await createTestUser({ role: 'VIEWER' });
    const res = await request(app)
      .post('/api/products/bulk-register')
      .set('Authorization', `Bearer ${tokenFor(viewer)}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/products/bulk-register').send({});
    expect(res.status).toBe(401);
  });

  it('registers PENDING and FAILED products that already have a classification code', async () => {
    const pending = await pendingProductWithCode();
    const failed = await pendingProductWithCode({ zraRegistrationStatus: 'FAILED', zraRegistrationError: 'old error' });
    vi.spyOn(itemManagementService, 'saveItemToVSDC').mockResolvedValue({
      success: true,
      itemCode: 'ok',
      zraResponse: { resultCd: '000' },
    });
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .post('/api/products/bulk-register')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ attempted: 2, registered: 2, failed: 0, skippedNoCode: 0 });
    // The DB write to REGISTERED happens inside the real saveItemToVSDC,
    // which this test replaces entirely with a mock — so the response body
    // (sourced from registerProductWithVsdc's own return value) is the
    // correct place to assert the success outcome, not the DB row.
    const ids = res.body.results.map((r) => r.productId).sort();
    expect(ids).toEqual([pending.id, failed.id].sort());
    expect(res.body.results.every((r) => r.status === 'REGISTERED')).toBe(true);
  });

  it('skips products with no classification code, reports them, and never calls VSDC for them', async () => {
    const category = await createTestCategory();
    const noCode = await createTestProduct({ categoryId: category.id, zraRegistrationStatus: 'PENDING' });
    const spy = vi.spyOn(itemManagementService, 'saveItemToVSDC');
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .post('/api/products/bulk-register')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.attempted).toBe(0);
    expect(res.body.skippedNoCode).toBe(1);
    expect(res.body.noCodeProducts.map((p) => p.id)).toContain(noCode.id);
    expect(spy).not.toHaveBeenCalled();

    const unchanged = await prisma.product.findUnique({ where: { id: noCode.id } });
    expect(unchanged.zraRegistrationStatus).toBe('PENDING');
  });

  it('one product failing registration does not stop the rest of the batch', async () => {
    const first = await pendingProductWithCode();
    const second = await pendingProductWithCode();
    vi.spyOn(itemManagementService, 'saveItemToVSDC')
      .mockResolvedValueOnce({ success: false, error: 'VSDC rejected this item' })
      .mockResolvedValueOnce({ success: true, itemCode: 'ok', zraResponse: { resultCd: '000' } });
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .post('/api/products/bulk-register')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ attempted: 2, registered: 1, failed: 1 });
    expect(res.body.results).toHaveLength(2);
    const statuses = res.body.results.map((r) => r.status).sort();
    expect(statuses).toEqual(['FAILED', 'REGISTERED']);
    // Confirms both requested products (first, second) are represented, not
    // dropped after the first failure.
    const ids = res.body.results.map((r) => r.productId).sort();
    expect(ids).toEqual([first.id, second.id].sort());
  });

  it('never re-selects an already-REGISTERED product', async () => {
    await pendingProductWithCode({ zraRegistrationStatus: 'REGISTERED', zraRegisteredAt: new Date() });
    const spy = vi.spyOn(itemManagementService, 'saveItemToVSDC');
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .post('/api/products/bulk-register')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.attempted).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a limit caps the batch and reports how many are left', async () => {
    await pendingProductWithCode();
    await pendingProductWithCode();
    await pendingProductWithCode();
    vi.spyOn(itemManagementService, 'saveItemToVSDC').mockResolvedValue({
      success: true,
      itemCode: 'ok',
      zraResponse: { resultCd: '000' },
    });
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .post('/api/products/bulk-register')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ attempted: 2, remaining: 1 });
  });
});
