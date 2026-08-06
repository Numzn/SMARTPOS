import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import reportsRouter from '../../routes/reports.js';
import saleFiscal from '../../lib/saleFiscal.js';

const {
  prisma,
  createTestBranch,
  createTestUser,
  createTestProduct,
  createTestInventory,
  createTestBatch,
  createTestSale,
  createTestShift,
  createTestSupplier,
  createTestPurchaseOrder,
  cleanupTestData,
  DEFAULT_BRANCH_CODE,
} = testData;
const { createTestApp } = testApp;
const { completeSaleAfterFiscalSuccess } = saleFiscal;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

/** A product with real stock and batches, so a sale can actually deduct from it. */
async function createSellableProduct({ stock = 10, unitCost = 60 } = {}) {
  const product = await createTestProduct();
  await createTestInventory(product.id, { currentStock: stock });
  await createTestBatch(product.id, { quantity: stock, unitCost });
  return product;
}

/** Completes a sale through the real fiscal path so a SALE_OUT movement exists. */
async function createCompletedSale({ user, product, quantity = 2, price = 100 }) {
  const sale = await createTestSale({ userId: user.id, productId: product.id, quantity, price });
  return completeSaleAfterFiscalSuccess(sale.id, { rcptNo: `TEST-RCPT-${sale.id.slice(-6)}` }, {}, DEFAULT_BRANCH_CODE);
}

describe('Phase 4 reports', () => {
  const app = createTestApp('/api/reports', reportsRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  /* ---------------- pre-existing endpoints (previously untested) ------------- */

  it('SMOKE: the pre-existing summary/weekly/transactions endpoints still respond', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const auth = `Bearer ${tokenFor(manager)}`;

    const [summary, weekly, transactions] = await Promise.all([
      request(app).get('/api/reports/summary').set('Authorization', auth),
      request(app).get('/api/reports/weekly').set('Authorization', auth),
      request(app).get('/api/reports/transactions').set('Authorization', auth),
    ]);

    expect(summary.status).toBe(200);
    expect(summary.body.today).toBeDefined();
    expect(weekly.status).toBe(200);
    expect(Array.isArray(weekly.body.weekly)).toBe(true);
    expect(transactions.status).toBe(200);
    expect(Array.isArray(transactions.body.transactions)).toBe(true);
  });

  /* ---------------- tax ---------------- */

  it('tax report sums the per-line ZRA tax amounts captured at sale time', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createSellableProduct({ stock: 20 });
    // 2 x 100 => taxable 200, tax 32 (16%) per createTestSale's math.
    await createCompletedSale({ user: manager, product, quantity: 2, price: 100 });
    await createCompletedSale({ user: manager, product, quantity: 3, price: 100 });

    const res = await request(app)
      .get('/api/reports/tax')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.transactionCount).toBe(2);
    expect(res.body.summary.taxableSales).toBe(500);
    expect(res.body.summary.totalTax).toBe(80); // 32 + 48
    expect(res.body.byCategory.length).toBeGreaterThan(0);
  });

  it('tax report exports CSV with a download filename', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createSellableProduct({ stock: 10 });
    await createCompletedSale({ user: manager, product, quantity: 1, price: 50 });

    const res = await request(app)
      .get('/api/reports/tax?format=csv')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('tax_report_');
    expect(res.text.split('\r\n')[0]).toBe('VAT Category,Taxable Amount,Tax Amount,Total Amount');
  });

  /* ---------------- profit ---------------- */

  it('profit report derives COGS from SALE_OUT movements, not current cost', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createSellableProduct({ stock: 10, unitCost: 60 });
    // 2 units sold at 100 => revenue 232 (incl. 16% tax); COGS 2 x 60 = 120.
    await createCompletedSale({ user: manager, product, quantity: 2, price: 100 });

    const res = await request(app)
      .get('/api/reports/profit')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.transactionCount).toBe(1);
    expect(res.body.summary.cogs).toBe(120);
    expect(res.body.summary.revenue).toBe(232);
    expect(res.body.summary.grossProfit).toBe(112);
    expect(res.body.summary.salesMissingCostBasis).toBe(0);
    expect(res.body.byProduct[0].productId).toBe(product.id);
    expect(res.body.byProduct[0].cogs).toBe(120);
  });

  it('profit report flags sales that have no cost basis rather than silently inflating margin', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createSellableProduct({ stock: 10 });
    // Marked COMPLETED directly — no fiscal completion, so no SALE_OUT movement.
    await createTestSale({
      userId: manager.id,
      productId: product.id,
      quantity: 2,
      price: 100,
      status: 'COMPLETED',
    });

    const res = await request(app)
      .get('/api/reports/profit')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.cogs).toBe(0);
    expect(res.body.summary.salesMissingCostBasis).toBe(1);
  });

  /* ---------------- cash & shifts (combined) ---------------- */

  it('shift report combines cash reconciliation and shift history in one view', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const openShift = await createTestShift({ userId: manager.id, openingFloat: 500 });
    const closedShift = await createTestShift({ userId: manager.id, openingFloat: 300, status: 'CLOSED' });
    await prisma.shift.update({
      where: { id: closedShift.id },
      data: { closedAt: new Date(), expectedCash: 300, countedCash: 290, variance: -10 },
    });

    const product = await createSellableProduct({ stock: 10 });
    const sale = await createTestSale({
      userId: manager.id,
      productId: product.id,
      quantity: 1,
      price: 100,
      shiftId: openShift.id,
    });
    await completeSaleAfterFiscalSuccess(sale.id, { rcptNo: 'TEST-RCPT-SHIFT' }, {}, DEFAULT_BRANCH_CODE);

    const res = await request(app)
      .get('/api/reports/shifts')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.shiftCount).toBe(2);
    expect(res.body.summary.openCount).toBe(1);
    expect(res.body.summary.closedCount).toBe(1);
    // Both the cash angle (variance) and the shift angle (sales attribution).
    expect(res.body.summary.totalVariance).toBe(-10);
    expect(res.body.summary.shiftsWithVariance).toBe(1);

    const openRow = res.body.shifts.find((s) => s.id === openShift.id);
    expect(openRow.salesCount).toBe(1);
    expect(openRow.salesTotal).toBe(116);
    expect(openRow.variance).toBeNull();

    const closedRow = res.body.shifts.find((s) => s.id === closedShift.id);
    expect(closedRow.variance).toBe(-10);
    expect(closedRow.durationMinutes).not.toBeNull();
  });

  it('shift report filters by status', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    await createTestShift({ userId: manager.id, openingFloat: 100 });
    await createTestShift({ userId: manager.id, openingFloat: 200, status: 'CLOSED' });

    const res = await request(app)
      .get('/api/reports/shifts?status=CLOSED')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.shiftCount).toBe(1);
    expect(res.body.shifts[0].status).toBe('CLOSED');
  });

  /* ---------------- purchases ---------------- */

  it('purchase report separates ordered value from received value', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const supplier = await createTestSupplier();
    const product = await createTestProduct();

    await createTestPurchaseOrder({
      supplierId: supplier.id,
      items: [{ productId: product.id, quantity: 10, unitCost: 20 }],
      status: 'SENT',
    });
    await createTestPurchaseOrder({
      supplierId: supplier.id,
      items: [{ productId: product.id, quantity: 5, unitCost: 20 }],
      status: 'CANCELLED',
    });

    const res = await request(app)
      .get('/api/reports/purchases')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.orderCount).toBe(2);
    expect(res.body.summary.totalOrderValue).toBe(300); // 200 + 100
    expect(res.body.summary.openOrders).toBe(1);
    expect(res.body.summary.cancelledOrders).toBe(1);
    // Nothing received yet, so received value stays zero even though orders exist.
    expect(res.body.summary.totalReceivedValue).toBe(0);
    expect(res.body.bySupplier[0].supplierId).toBe(supplier.id);
    expect(res.body.bySupplier[0].orderCount).toBe(2);
  });

  /* ---------------- user activity ---------------- */

  it('user activity report is gated on audit:read, not reports:read', async () => {
    const viewer = await createTestUser({ role: 'VIEWER' }); // has reports:read, not audit:read
    const admin = await createTestUser({ role: 'ADMIN' });

    const denied = await request(app)
      .get('/api/reports/user-activity')
      .set('Authorization', `Bearer ${tokenFor(viewer)}`);
    expect(denied.status).toBe(403);

    // Same user can still read the ordinary business reports.
    const allowedElsewhere = await request(app)
      .get('/api/reports/tax')
      .set('Authorization', `Bearer ${tokenFor(viewer)}`);
    expect(allowedElsewhere.status).toBe(200);

    const allowed = await request(app)
      .get('/api/reports/user-activity')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.summary).toBeDefined();
    expect(Array.isArray(allowed.body.byUser)).toBe(true);
  });

  it('user activity aggregates audit events per user', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await prisma.auditLog.createMany({
      data: [1, 2, 3].map((n) => ({
        id: `TEST-AUDIT-${admin.id}-${n}`,
        eventType: 'REPORT_TEST_EVENT',
        userId: admin.id,
        userRole: 'ADMIN',
        action: 'TEST',
        hash: `test-hash-${n}`,
      })),
    });

    const res = await request(app)
      .get(`/api/reports/user-activity?userId=${admin.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.totalEvents).toBe(3);
    expect(res.body.byUser[0].userId).toBe(admin.id);
    expect(res.body.byUser[0].eventCount).toBe(3);
    expect(res.body.byEventType.find((e) => e.eventType === 'REPORT_TEST_EVENT').count).toBe(3);

    await prisma.auditLog.deleteMany({ where: { id: { startsWith: `TEST-AUDIT-${admin.id}` } } });
  });
});
