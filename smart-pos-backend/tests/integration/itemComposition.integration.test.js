import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestBranch, createTestUser, createTestCategory, createTestProduct, cleanupTestData, prisma } =
  testData;
const { createTestApp } = testApp;

const productsRouter = require('../../routes/products.js');
const vsdcService = require('../../services/vsdcService.js');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

function mockVsdcSuccess() {
  vsdcService.isInitialized = true;
  return vi
    .spyOn(vsdcService, 'makeAuthenticatedRequest')
    .mockResolvedValue({ success: true, data: { resultCd: '000', resultMsg: 'It is succeeded' } });
}

// Section 6.5 (item 9*, OPTIONAL per spec): /api/products/:id/composition.
describe('GET/POST/DELETE /api/products/:id/composition', () => {
  const app = createTestApp('/api/products', productsRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
    vi.restoreAllMocks();
    vsdcService.isInitialized = false;
  });

  it('all three routes are gated behind authentication', async () => {
    const category = await createTestCategory();
    const parent = await createTestProduct({ categoryId: category.id });

    expect((await request(app).get(`/api/products/${parent.id}/composition`)).status).toBe(401);
    expect((await request(app).post(`/api/products/${parent.id}/composition`).send({})).status).toBe(401);
    expect((await request(app).delete(`/api/products/${parent.id}/composition/whatever`)).status).toBe(401);
  });

  it('REGRESSION: POST is gated behind products:write — a cashier is forbidden', async () => {
    const category = await createTestCategory();
    const parent = await createTestProduct({ categoryId: category.id });
    const component = await createTestProduct({ categoryId: category.id });
    const cashier = await createTestUser({ role: 'CASHIER' });

    const res = await request(app)
      .post(`/api/products/${parent.id}/composition`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ componentProductId: component.id, quantity: 1 });

    expect(res.status).toBe(403);
  });

  it('adds a component, registers with VSDC, and lists it back with product details', async () => {
    const category = await createTestCategory();
    const parent = await createTestProduct({ categoryId: category.id, sku: 'TEST-SKU-BUNDLE-1' });
    const component = await createTestProduct({ categoryId: category.id, sku: 'TEST-SKU-PART-1', name: 'Widget' });
    const user = await createTestUser({ role: 'MANAGER' });
    mockVsdcSuccess();

    const addRes = await request(app)
      .post(`/api/products/${parent.id}/composition`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ componentProductId: component.id, quantity: 3 });

    expect(addRes.status).toBe(201);
    expect(addRes.body.component.zraRegistrationStatus).toBe('REGISTERED');

    const listRes = await request(app)
      .get(`/api/products/${parent.id}/composition`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.components).toHaveLength(1);
    expect(listRes.body.components[0].quantity).toBe(3);
    expect(listRes.body.components[0].componentProduct.name).toBe('Widget');
  });

  it('rejects a product being its own component with 400', async () => {
    const category = await createTestCategory();
    const parent = await createTestProduct({ categoryId: category.id });
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .post(`/api/products/${parent.id}/composition`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ componentProductId: parent.id, quantity: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot be a component of itself/);
  });

  it('surfaces a VSDC rejection as 400 and still records the row as FAILED (not silently dropped)', async () => {
    const category = await createTestCategory();
    const parent = await createTestProduct({ categoryId: category.id });
    const component = await createTestProduct({ categoryId: category.id });
    const user = await createTestUser({ role: 'MANAGER' });
    vsdcService.isInitialized = true;
    vi.spyOn(vsdcService, 'makeAuthenticatedRequest').mockResolvedValue({
      success: true,
      data: { resultCd: '999', resultMsg: 'Simulated rejection' },
    });

    const res = await request(app)
      .post(`/api/products/${parent.id}/composition`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ componentProductId: component.id, quantity: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Simulated rejection/);

    const row = await prisma.productComposition.findFirst({
      where: { parentProductId: parent.id, componentProductId: component.id },
    });
    expect(row.zraRegistrationStatus).toBe('FAILED');
  });

  it('removes a component locally, without any further VSDC call', async () => {
    const category = await createTestCategory();
    const parent = await createTestProduct({ categoryId: category.id });
    const component = await createTestProduct({ categoryId: category.id });
    const user = await createTestUser({ role: 'MANAGER' });
    const requestSpy = mockVsdcSuccess();

    const addRes = await request(app)
      .post(`/api/products/${parent.id}/composition`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ componentProductId: component.id, quantity: 1 });
    requestSpy.mockClear();

    const delRes = await request(app)
      .delete(`/api/products/${parent.id}/composition/${addRes.body.component.id}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(delRes.status).toBe(200);
    expect(requestSpy).not.toHaveBeenCalled();

    const listRes = await request(app)
      .get(`/api/products/${parent.id}/composition`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(listRes.body.components).toHaveLength(0);
  });

  it('deleting a parent product cleans up its composition rows instead of failing on FK constraint', async () => {
    const category = await createTestCategory();
    const parent = await createTestProduct({ categoryId: category.id });
    const component = await createTestProduct({ categoryId: category.id });
    const user = await createTestUser({ role: 'ADMIN' });
    mockVsdcSuccess();

    await request(app)
      .post(`/api/products/${parent.id}/composition`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ componentProductId: component.id, quantity: 1 });

    const delRes = await request(app)
      .delete(`/api/products/${parent.id}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(delRes.status).toBe(200);
    const remaining = await prisma.productComposition.findMany({ where: { parentProductId: parent.id } });
    expect(remaining).toHaveLength(0);
  });
});
