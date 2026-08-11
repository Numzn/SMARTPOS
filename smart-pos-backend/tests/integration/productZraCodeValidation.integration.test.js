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

// Section 5 UI layer (zra-self-checklist.md item 8*): taxType/zraPackageUnit/
// zraQuantityUnit validity-if-present gate in routes/products.js
// (assertProductZraCodes -> zraCodesService.isUsableStandardCode). These
// hit the route directly with supertest, bypassing any UI — the same path
// a scripted or malicious direct API call would take (requirement: "backend
// direct API bypass" coverage).
//
// Unlike classification code, these three fields are NOT required — making
// them mandatory would break the 200+ pre-existing products that predate
// this UI (confirmed live on Numzlab: virtually all have these unset). So
// the coverage here is "if you send a value, it must be real" — never
// "you must send a value."
//
// Every test still needs a valid classification code, though — that field
// IS required in strict mode by pre-existing logic (both routes/products.js's
// own presence check and, for updates, lib/productRegistration.js's
// validateRegistrationFields run again inside registerAfterSave) — unrelated
// to what's under test here, but a hard prerequisite to reach it.
describe('POST/PUT /api/products — taxType/zraPackageUnit/zraQuantityUnit validity gate', () => {
  const app = createTestApp('/api/products', productsRouter);
  const BASE_CLASS_CODE = 'PZC-BASE-CLASS';

  beforeAll(async () => {
    await createTestBranch();
    await prisma.zraClassificationCode.upsert({
      where: { code: BASE_CLASS_CODE },
      create: { code: BASE_CLASS_CODE, name: 'Base classification for these tests', useYn: 'Y' },
      update: { useYn: 'Y' },
    });
  });

  afterEach(async () => {
    await prisma.zraCode.deleteMany({ where: { code: { startsWith: 'PZC-' } } });
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  async function seedCurrent(codeClass, code, name = `Usable ${code}`) {
    await prisma.zraCode.upsert({
      where: { codeClass_code: { codeClass, code } },
      create: { codeClass, code, name, syncedAt: new Date() },
      update: { name, syncedAt: new Date() },
    });
  }

  function mockVsdcSuccess() {
    vi.spyOn(itemManagementService, 'saveItemToVSDC').mockResolvedValue({
      success: true,
      itemCode: 'ignored-in-mock',
      zraResponse: { resultCd: '000' },
    });
  }

  it('accepts product creation with a valid, currently-synced tax type', async () => {
    await seedCurrent('04', 'PZC-TAX-1');
    const category = await createTestCategory();
    const user = await createTestUser({ role: 'MANAGER' });
    mockVsdcSuccess();

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        name: 'Valid Tax Type Product',
        sku: 'TEST-SKU-PZC-1',
        price: 10,
        categoryId: category.id,
        zraClassificationCode: BASE_CLASS_CODE,
        taxType: 'PZC-TAX-1',
      });

    expect(res.status).toBe(201);
    expect(res.body.product.taxType).toBe('PZC-TAX-1');
  });

  it('accepts product creation with a valid, currently-synced package unit', async () => {
    await seedCurrent('17', 'PZC-PKG-1');
    const category = await createTestCategory();
    const user = await createTestUser({ role: 'MANAGER' });
    mockVsdcSuccess();

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        name: 'Valid Package Unit Product',
        sku: 'TEST-SKU-PZC-2',
        price: 10,
        categoryId: category.id,
        zraClassificationCode: BASE_CLASS_CODE,
        zraPackageUnit: 'PZC-PKG-1',
      });

    expect(res.status).toBe(201);
    expect(res.body.product.zraPackageUnit).toBe('PZC-PKG-1');
  });

  it('accepts product creation with a valid, currently-synced quantity unit', async () => {
    await seedCurrent('10', 'PZC-QTY-1');
    const category = await createTestCategory();
    const user = await createTestUser({ role: 'MANAGER' });
    mockVsdcSuccess();

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        name: 'Valid Quantity Unit Product',
        sku: 'TEST-SKU-PZC-3',
        price: 10,
        categoryId: category.id,
        zraClassificationCode: BASE_CLASS_CODE,
        zraQuantityUnit: 'PZC-QTY-1',
      });

    expect(res.status).toBe(201);
    expect(res.body.product.zraQuantityUnit).toBe('PZC-QTY-1');
  });

  it('rejects an invalid (never-synced) tax type', async () => {
    const category = await createTestCategory();
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        name: 'Invalid Tax Type Product',
        sku: 'TEST-SKU-PZC-4',
        price: 10,
        categoryId: category.id,
        zraClassificationCode: BASE_CLASS_CODE,
        taxType: 'PZC-MADE-UP-TAX',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ZRA_CODE');
    const created = await prisma.product.findUnique({ where: { sku: 'TEST-SKU-PZC-4' } });
    expect(created).toBeNull();
  });

  it('rejects an invalid (never-synced) package unit', async () => {
    const category = await createTestCategory();
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        name: 'Invalid Package Unit Product',
        sku: 'TEST-SKU-PZC-5',
        price: 10,
        categoryId: category.id,
        zraClassificationCode: BASE_CLASS_CODE,
        zraPackageUnit: 'PZC-MADE-UP-PKG',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ZRA_CODE');
  });

  it('rejects an invalid (never-synced) quantity unit', async () => {
    const category = await createTestCategory();
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        name: 'Invalid Quantity Unit Product',
        sku: 'TEST-SKU-PZC-6',
        price: 10,
        categoryId: category.id,
        zraClassificationCode: BASE_CLASS_CODE,
        zraQuantityUnit: 'PZC-MADE-UP-QTY',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ZRA_CODE');
  });

  it('rejects a tax type that is stale relative to the most recent sync (implied deprecated)', async () => {
    const now = new Date();
    await prisma.zraCode.upsert({
      where: { codeClass_code: { codeClass: '04', code: 'PZC-FRESH' } },
      create: { codeClass: '04', code: 'PZC-FRESH', name: 'Fresh', syncedAt: now },
      update: { syncedAt: now },
    });
    await prisma.zraCode.upsert({
      where: { codeClass_code: { codeClass: '04', code: 'PZC-STALE' } },
      create: { codeClass: '04', code: 'PZC-STALE', name: 'Stale', syncedAt: new Date(now.getTime() - 10 * 60 * 1000) },
      update: { syncedAt: new Date(now.getTime() - 10 * 60 * 1000) },
    });
    const category = await createTestCategory();
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        name: 'Stale Tax Type Product',
        sku: 'TEST-SKU-PZC-7',
        price: 10,
        categoryId: category.id,
        zraClassificationCode: BASE_CLASS_CODE,
        taxType: 'PZC-STALE',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ZRA_CODE');
  });

  it('accepts a product with none of the three fields set — existing pre-UI products are not broken', async () => {
    const category = await createTestCategory();
    const user = await createTestUser({ role: 'MANAGER' });
    mockVsdcSuccess();

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        name: 'No ZRA Standard Codes Product',
        sku: 'TEST-SKU-PZC-8',
        price: 10,
        categoryId: category.id,
        zraClassificationCode: BASE_CLASS_CODE,
      });

    expect(res.status).toBe(201);
    expect(res.body.product.taxType).toBeNull();
    expect(res.body.product.zraPackageUnit).toBeNull();
    expect(res.body.product.zraQuantityUnit).toBeNull();
  });

  it('editing an existing product without touching these fields does not reject it', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({
      categoryId: category.id,
      sku: 'TEST-SKU-PZC-9',
      zraClassificationCode: BASE_CLASS_CODE,
    });
    const user = await createTestUser({ role: 'MANAGER' });
    mockVsdcSuccess();

    const res = await request(app)
      .put(`/api/products/${product.id}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        name: product.name,
        sku: product.sku,
        price: product.price,
        categoryId: category.id,
        zraClassificationCode: BASE_CLASS_CODE,
      });

    expect(res.status).toBe(200);
  });

  it('editing an existing product to set a valid tax type persists it', async () => {
    await seedCurrent('04', 'PZC-EDIT-TAX');
    const category = await createTestCategory();
    const product = await createTestProduct({
      categoryId: category.id,
      sku: 'TEST-SKU-PZC-10',
      zraClassificationCode: BASE_CLASS_CODE,
    });
    const user = await createTestUser({ role: 'MANAGER' });
    mockVsdcSuccess();

    const res = await request(app)
      .put(`/api/products/${product.id}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        name: product.name,
        sku: product.sku,
        price: product.price,
        categoryId: category.id,
        zraClassificationCode: BASE_CLASS_CODE,
        taxType: 'PZC-EDIT-TAX',
      });

    // Unlike the create route (res.body.product.*), the update route spreads
    // the product's fields at the top level of the response.
    expect(res.status).toBe(200);
    expect(res.body.taxType).toBe('PZC-EDIT-TAX');
  });

  it('editing an existing product with an invalid tax type is rejected without changing the stored product', async () => {
    await seedCurrent('04', 'PZC-EXISTING-GOOD');
    const category = await createTestCategory();
    const product = await createTestProduct({
      categoryId: category.id,
      sku: 'TEST-SKU-PZC-11',
      zraClassificationCode: BASE_CLASS_CODE,
      taxType: 'PZC-EXISTING-GOOD',
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
        zraClassificationCode: BASE_CLASS_CODE,
        taxType: 'PZC-BOGUS',
      });

    expect(res.status).toBe(400);
    const unchanged = await prisma.product.findUnique({ where: { id: product.id } });
    expect(unchanged.taxType).toBe('PZC-EXISTING-GOOD');
  });
});
