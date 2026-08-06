import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import suppliersRouter from '../../routes/suppliers.js';

const { createTestBranch, createTestUser, createTestSupplier, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

describe('Supplier CRUD routes', () => {
  const app = createTestApp('/api/suppliers', suppliersRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('a cashier is forbidden from every supplier route (back-office only)', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const supplier = await createTestSupplier();

    const listRes = await request(app).get('/api/suppliers').set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(listRes.status).toBe(403);

    const createRes = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ name: 'TEST-Supplier-ShouldFail' });
    expect(createRes.status).toBe(403);

    const getRes = await request(app)
      .get(`/api/suppliers/${supplier.id}`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(getRes.status).toBe(403);
  });

  it('a viewer can read but not write', async () => {
    const viewer = await createTestUser({ role: 'VIEWER' });

    const listRes = await request(app).get('/api/suppliers').set('Authorization', `Bearer ${tokenFor(viewer)}`);
    expect(listRes.status).toBe(200);

    const createRes = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${tokenFor(viewer)}`)
      .send({ name: 'TEST-Supplier-ShouldFail' });
    expect(createRes.status).toBe(403);
  });

  it('a manager can create, update, and deactivate a supplier', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });

    const createRes = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ name: 'TEST-Supplier-Acme', contactPerson: 'Jane' });
    expect(createRes.status).toBe(201);
    const supplierId = createRes.body.supplier.id;

    const updateRes = await request(app)
      .put(`/api/suppliers/${supplierId}`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ phone: '260955555555' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.supplier.phone).toBe('260955555555');

    const deleteRes = await request(app)
      .delete(`/api/suppliers/${supplierId}`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`);
    expect(deleteRes.status).toBe(200);

    const reloaded = await prisma.supplier.findUnique({ where: { id: supplierId } });
    expect(reloaded.isActive).toBe(false);
  });

  it('GET /:id/purchase-history returns empty lists for a supplier with no POs yet', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const supplier = await createTestSupplier();

    const res = await request(app)
      .get(`/api/suppliers/${supplier.id}/purchase-history`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`);
    expect(res.status).toBe(200);
    expect(res.body.purchaseOrders).toEqual([]);
    expect(res.body.goodsReceivedNotes).toEqual([]);
  });

  it('rejects creating a supplier without a name', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const res = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ contactPerson: 'No Name' });
    expect(res.status).toBe(400);
  });
});
