import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestBranch, createTestUser, createTestCategory, createTestProduct, cleanupTestData, prisma } =
  testData;
const { createTestApp } = testApp;

const productsRouter = require('../../routes/products.js');
// registerAfterSave (called after a successful create/update) reaches this
// live — stub it so these tests exercise only the classification-code gate
// added to routes/products.js, not a real VSDC round-trip.
const itemManagementService = require('../../services/itemManagement.js');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

// Section 5 UI layer (zra-self-checklist.md item 8*): the ClassificationPicker
// only ever emits a code it got back from the search endpoint, but the API is
// the real enforcement boundary for "no arbitrary free-text classification
// codes" — these tests hit routes/products.js directly, bypassing the UI
// entirely, the way a scripted or malicious direct API call would.
describe('POST/PUT /api/products — classification code validity gate', () => {
  const app = createTestApp('/api/products', productsRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await prisma.zraClassificationCode.deleteMany({ where: { code: { startsWith: 'PRODVALID-' } } });
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  async function seedUsableCode(code) {
    await prisma.zraClassificationCode.upsert({
      where: { code },
      create: { code, name: `Usable code ${code}`, useYn: 'Y' },
      update: { useYn: 'Y' },
    });
  }

  it('rejects product creation with a classification code that was never synced', async () => {
    const category = await createTestCategory();
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        name: 'Test Product Invalid Class',
        sku: 'TEST-SKU-PRODVALID-1',
        price: 10,
        categoryId: category.id,
        zraClassificationCode: 'PRODVALID-MADE-UP-CODE',
        zraPackageUnit: 'EA',
        zraQuantityUnit: 'EA',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CLASSIFICATION_CODE');

    const created = await prisma.product.findUnique({ where: { sku: 'TEST-SKU-PRODVALID-1' } });
    expect(created).toBeNull();
  });

  it('rejects product creation with a classification code ZRA has marked useYn=N', async () => {
    await seedUsableCode('PRODVALID-DEPRECATED');
    await prisma.zraClassificationCode.update({
      where: { code: 'PRODVALID-DEPRECATED' },
      data: { useYn: 'N' },
    });
    const category = await createTestCategory();
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        name: 'Test Product Deprecated Class',
        sku: 'TEST-SKU-PRODVALID-2',
        price: 10,
        categoryId: category.id,
        zraClassificationCode: 'PRODVALID-DEPRECATED',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CLASSIFICATION_CODE');
  });

  it('accepts product creation with a valid, synced, usable classification code', async () => {
    await seedUsableCode('PRODVALID-GOOD');
    const category = await createTestCategory();
    const user = await createTestUser({ role: 'MANAGER' });
    vi.spyOn(itemManagementService, 'saveItemToVSDC').mockResolvedValue({
      success: true,
      itemCode: 'TEST-SKU-PRODVALID-3',
      zraResponse: { resultCd: '000' },
    });

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        name: 'Test Product Valid Class',
        sku: 'TEST-SKU-PRODVALID-3',
        price: 10,
        categoryId: category.id,
        zraClassificationCode: 'PRODVALID-GOOD',
        zraPackageUnit: 'EA',
        zraQuantityUnit: 'EA',
      });

    expect(res.status).toBe(201);
    expect(res.body.product.zraClassificationCode).toBe('PRODVALID-GOOD');
  });

  it('rejects product update with an unusable classification code', async () => {
    await seedUsableCode('PRODVALID-GOOD-2');
    const category = await createTestCategory();
    const product = await createTestProduct({
      categoryId: category.id,
      sku: 'TEST-SKU-PRODVALID-4',
      zraClassificationCode: 'PRODVALID-GOOD-2',
    });
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .put(`/api/products/${product.id}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        name: product.name,
        sku: product.sku,
        price: product.price,
        categoryId: category.id,
        zraClassificationCode: 'PRODVALID-NOT-REAL',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CLASSIFICATION_CODE');
  });

  it('accepts product update that keeps an existing valid classification code', async () => {
    await seedUsableCode('PRODVALID-GOOD-3');
    const category = await createTestCategory();
    const product = await createTestProduct({
      categoryId: category.id,
      sku: 'TEST-SKU-PRODVALID-5',
      zraClassificationCode: 'PRODVALID-GOOD-3',
    });
    const user = await createTestUser({ role: 'MANAGER' });
    vi.spyOn(itemManagementService, 'saveItemToVSDC').mockResolvedValue({
      success: true,
      itemCode: product.sku,
      zraResponse: { resultCd: '000' },
    });

    const res = await request(app)
      .put(`/api/products/${product.id}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        name: product.name,
        sku: product.sku,
        price: product.price,
        categoryId: category.id,
        zraClassificationCode: 'PRODVALID-GOOD-3',
      });

    expect(res.status).toBe(200);
  });
});
