import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import customersRouter from '../../routes/customers.js';

const { createTestBranch, createTestUser, createTestCustomer, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

describe('Customer CRUD routes', () => {
  const app = createTestApp('/api/customers', customersRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('a cashier can create a customer (quick-add at checkout) but not deactivate one', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });

    const createRes = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ name: 'TEST-Customer-Walkin', phone: '260971111111' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.customer.name).toBe('TEST-Customer-Walkin');

    const deleteRes = await request(app)
      .delete(`/api/customers/${createRes.body.customer.id}`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(deleteRes.status).toBe(403);
  });

  it('rejects creating a customer without a name', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ phone: '260971111111' });
    expect(res.status).toBe(400);
  });

  it('a manager can update and then deactivate a customer', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const customer = await createTestCustomer();

    const updateRes = await request(app)
      .put(`/api/customers/${customer.id}`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ email: 'updated@example.com' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.customer.email).toBe('updated@example.com');

    const deleteRes = await request(app)
      .delete(`/api/customers/${customer.id}`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`);
    expect(deleteRes.status).toBe(200);

    const reloaded = await prisma.customer.findUnique({ where: { id: customer.id } });
    expect(reloaded.isActive).toBe(false);
    expect(reloaded.deactivatedAt).not.toBeNull();
  });

  it('deactivated customers are excluded from the default list', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const customer = await createTestCustomer();
    await request(app)
      .delete(`/api/customers/${customer.id}`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    const listRes = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.customers.find((c) => c.id === customer.id)).toBeUndefined();
  });

  it('search by phone/name finds the right customer', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const customer = await createTestCustomer({ phone: '260979998888' });

    const res = await request(app)
      .get('/api/customers?q=979998888')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);
    expect(res.status).toBe(200);
    expect(res.body.customers.some((c) => c.id === customer.id)).toBe(true);
  });
});
