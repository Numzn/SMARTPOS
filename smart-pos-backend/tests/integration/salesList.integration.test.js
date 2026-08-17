import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestBranch, createTestUser, createSellableProduct, createTestSale, cleanupTestData } = testData;
const { createTestApp } = testApp;

const salesRouter = require('../../routes/sales.js');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

describe('GET /api/sales', () => {
  const app = createTestApp('/api/sales', salesRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('REGRESSION: a Cashier only sees their own sales, not the whole store\'s', async () => {
    const cashierA = await createTestUser({ role: 'CASHIER' });
    const cashierB = await createTestUser({ role: 'CASHIER' });
    const product = await createSellableProduct({ stock: 10 });
    const ownSale = await createTestSale({ userId: cashierA.id, productId: product.id, status: 'COMPLETED' });
    await createTestSale({ userId: cashierB.id, productId: product.id, status: 'COMPLETED' });

    const res = await request(app)
      .get('/api/sales')
      .set('Authorization', `Bearer ${tokenFor(cashierA)}`);

    expect(res.status).toBe(200);
    expect(res.body.map((s) => s.id)).toEqual([ownSale.id]);
  });

  it('a Supervisor sees every sale across all cashiers', async () => {
    const cashierA = await createTestUser({ role: 'CASHIER' });
    const cashierB = await createTestUser({ role: 'CASHIER' });
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const product = await createSellableProduct({ stock: 10 });
    await createTestSale({ userId: cashierA.id, productId: product.id, status: 'COMPLETED' });
    await createTestSale({ userId: cashierB.id, productId: product.id, status: 'COMPLETED' });

    const res = await request(app)
      .get('/api/sales')
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});
