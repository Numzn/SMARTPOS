import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import inventoryRouter from '../../routes/inventory/index.js';

const { createTestBranch, createTestUser, createTestProduct, cleanupTestData, prisma, DEFAULT_BRANCH_CODE } =
  testData;
const { createTestApp } = testApp;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

// Regression guard for the lib/receiving.js extraction (Phase 3). This locks
// down the exact current contract of POST /api/inventory/receive BEFORE the
// transaction body is moved into a shared, reusable function — it must pass
// unchanged before and after the extraction. Do not delete after the
// extraction lands; keep it as the permanent contract test for that path.
describe('POST /api/inventory/receive (pre-extraction contract)', () => {
  const app = createTestApp('/api/inventory', inventoryRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('first receipt: sets currentStock, averageCost, batch and movement fields exactly as today', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createTestProduct();

    const res = await request(app)
      .post('/api/inventory/receive')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ productId: product.id, quantity: 10, unitCost: 50, supplierInfo: 'Acme Distributors' });

    expect(res.status).toBe(200);
    expect(res.body.inventory.currentStock).toBe(10);
    expect(res.body.inventory.averageCost).toBe(50);
    expect(res.body.batch.quantity).toBe(10);
    expect(res.body.batch.unitCost).toBe(50);
    expect(res.body.batch.costPrice).toBe(50);
    expect(res.body.batch.sellingPrice).toBe(60); // unitCost * 1.2
    expect(res.body.batch.supplier).toBe('Acme Distributors');
    expect(res.body.batch.batchNumber).toMatch(/^BATCH-\d+$/);
    expect(res.body.batch.status).toBe('ACTIVE');
    expect(res.body.movement.movementType).toBe('PURCHASE_IN');
    expect(res.body.movement.quantity).toBe(10);
    expect(res.body.movement.previousStock).toBe(0);
    expect(res.body.movement.newStock).toBe(10);

    const dbMovement = await prisma.stockMovement.findUnique({ where: { id: res.body.movement.id } });
    expect(dbMovement.referenceType).toBe('PURCHASE');
  });

  it('second receipt: blends into a weighted-average cost exactly as today', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createTestProduct();

    await request(app)
      .post('/api/inventory/receive')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ productId: product.id, quantity: 10, unitCost: 50, supplierInfo: 'Acme Distributors' });

    const res = await request(app)
      .post('/api/inventory/receive')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ productId: product.id, quantity: 10, unitCost: 70, supplierInfo: 'Acme Distributors' });

    expect(res.status).toBe(200);
    expect(res.body.inventory.currentStock).toBe(20);
    // (10*50 + 10*70) / 20 = 60
    expect(res.body.inventory.averageCost).toBe(60);
    expect(res.body.movement.previousStock).toBe(10);
    expect(res.body.movement.newStock).toBe(20);
  });

  it('defaults supplier to "Unknown" and batchNumber to BATCH-<timestamp> when omitted', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createTestProduct();

    const res = await request(app)
      .post('/api/inventory/receive')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ productId: product.id, quantity: 5, unitCost: 20 });

    expect(res.status).toBe(200);
    expect(res.body.batch.supplier).toBe('Unknown');
    expect(res.body.batch.batchNumber).toMatch(/^BATCH-\d+$/);
  });

  it('rejects a request missing required fields', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const res = await request(app)
      .post('/api/inventory/receive')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ quantity: 5 });
    expect(res.status).toBe(400);
  });

  it('is gated behind inventory:write — a cashier is forbidden', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const product = await createTestProduct();
    const res = await request(app)
      .post('/api/inventory/receive')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ productId: product.id, quantity: 5, unitCost: 20 });
    expect(res.status).toBe(403);
  });
});
