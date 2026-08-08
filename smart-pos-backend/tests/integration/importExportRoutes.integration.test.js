import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import inventoryRouter from '../../routes/inventory/index.js';
import productsRouter from '../../routes/products.js';
import customersRouter from '../../routes/customers.js';
import suppliersRouter from '../../routes/suppliers.js';

const {
  createTestBranch,
  createTestUser,
  createTestProduct,
  createTestInventory,
  createTestBatch,
  cleanupTestData,
} = testData;
const { createTestApp } = testApp;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

/**
 * Route-level cover for the import/export endpoints.
 *
 * The library functions were well tested but nothing exercised the HTTP layer,
 * so a route referencing an unimported constant (DEFAULT_BRANCH) passed every
 * test and still 500'd on the first real request. These tests hit the routes.
 */
describe('import/export endpoints', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  async function stocked({ stock = 10 } = {}) {
    const product = await createTestProduct();
    await createTestInventory(product.id, { currentStock: stock });
    await createTestBatch(product.id, { quantity: stock, unitCost: 5 });
    return product;
  }

  it('REGRESSION: every export endpoint responds, not 500s on a missing import', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const auth = `Bearer ${tokenFor(admin)}`;
    await stocked();

    const cases = [
      ['/api/inventory', inventoryRouter, '/api/inventory/export'],
      ['/api/products', productsRouter, '/api/products/export'],
      ['/api/customers', customersRouter, '/api/customers/export'],
      ['/api/suppliers', suppliersRouter, '/api/suppliers/export'],
    ];

    for (const [mount, router, path] of cases) {
      const res = await request(createTestApp(mount, router)).get(path).set('Authorization', auth);
      expect(res.status, `${path} returned ${res.status}: ${res.text?.slice(0, 200)}`).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
    }
  });

  it('inventory export emits a stock-take sheet with counted left blank', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const product = await stocked({ stock: 7 });

    const res = await request(createTestApp('/api/inventory', inventoryRouter))
      .get('/api/inventory/export')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    const [header, ...lines] = res.text.split('\r\n');
    expect(header.split(',')).toEqual(
      expect.arrayContaining(['sku', 'onHand', 'reserved', 'sellable', 'counted'])
    );
    const row = lines.find((l) => l.startsWith(product.sku));
    expect(row).toBeTruthy();
    expect(row.endsWith(',')).toBe(true); // counted blank, ready to fill in
  });

  it('inventory import previews deltas over HTTP without writing', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const product = await stocked({ stock: 10 });

    const res = await request(createTestApp('/api/inventory', inventoryRouter))
      .post('/api/inventory/import')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ csv: `sku,counted\n${product.sku},6`, commit: false });

    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.summary).toMatchObject({ decrease: 1, error: 0 });
    expect(res.body.rows[0]).toMatchObject({ onHand: 10, counted: 6, delta: -4 });
  });

  it('rejects an import with no CSV content', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const res = await request(createTestApp('/api/inventory', inventoryRouter))
      .post('/api/inventory/import')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ commit: false });

    expect(res.status).toBe(400);
  });

  it('a cashier cannot export the catalogue-management data or run a stock take', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const auth = `Bearer ${tokenFor(cashier)}`;

    const stockTake = await request(createTestApp('/api/inventory', inventoryRouter))
      .post('/api/inventory/import')
      .set('Authorization', auth)
      .send({ csv: 'sku,counted\nX,1', commit: true });
    expect(stockTake.status).toBe(403);

    const suppliers = await request(createTestApp('/api/suppliers', suppliersRouter))
      .get('/api/suppliers/export')
      .set('Authorization', auth);
    expect(suppliers.status).toBe(403);
  });

  it('"export" is not swallowed by the /:id wildcard', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const auth = `Bearer ${tokenFor(admin)}`;

    // If /:id were matched first these would 404 as a missing record rather
    // than returning a file.
    for (const [mount, router] of [
      ['/api/customers', customersRouter],
      ['/api/suppliers', suppliersRouter],
    ]) {
      const res = await request(createTestApp(mount, router)).get(`${mount}/export`).set('Authorization', auth);
      expect(res.headers['content-type']).toContain('text/csv');
    }
  });
});
