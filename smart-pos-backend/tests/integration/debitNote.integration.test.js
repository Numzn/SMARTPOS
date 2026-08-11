import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestBranch, createTestUser, createSellableProduct, createTestSale, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

// routes/sales.js -> lib/saleDebitNote.js -> services/zraInvoice.js (singleton).
// No mock VSDC server is reachable from the isolated test network this suite
// runs against (see memory: smartpos-backend-test-recipe), so the network
// boundary — submitFiscalForDebitNote — is monkey-patched here, same
// approach as tests/integration/settingsBackup.integration.test.js. Payload
// construction itself (rcptTyCd=D, dbtRsnCd, invcAdjustReason) is covered
// without any mocking in tests/unit/debitNotePayload.unit.test.js.
const zraInvoiceService = require('../../services/zraInvoice.js');
const vsdcService = require('../../services/vsdcService.js');
zraInvoiceService.submitFiscalForDebitNote = vi.fn();
vsdcService.isDeviceReady = vi.fn().mockResolvedValue(true);
const submitFiscalForDebitNoteSpy = zraInvoiceService.submitFiscalForDebitNote;

const salesRouter = require('../../routes/sales.js');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

async function createCompletedFiscalSale(userId, productId) {
  const sale = await createTestSale({ userId, productId, quantity: 2, price: 100, status: 'PENDING' });
  return prisma.sale.update({
    where: { id: sale.id },
    data: {
      status: 'COMPLETED',
      rcptNo: `MOCK-RCPT-${sale.id.slice(-6)}`,
      fiscalInvcNo: Math.floor(Math.random() * 1_000_000) + 1000,
      vsdcResponse: { invcNo: 1 },
    },
    include: { saleItems: true },
  });
}

function mockSuccessfulSubmission(overrides = {}) {
  submitFiscalForDebitNoteSpy.mockResolvedValue({
    success: true,
    message: 'Debit note submitted successfully',
    zraResponse: {
      rcptNo: 'MOCK-DBT-1',
      qrCode: 'QR-DBT-1',
      rcptSign: 'SIGN-DBT-1',
      intrlData: 'INTRL-DBT-1',
    },
    vsdcRequest: { receiptType: 'D', originalInvoiceNumber: 1, ...overrides.vsdcRequest },
    vsdcResponse: { resultCd: '000' },
  });
}

describe('POST /api/sales/:id/debit-note', () => {
  const app = createTestApp('/api/sales', salesRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    submitFiscalForDebitNoteSpy.mockReset();
    await cleanupTestData();
  });

  it('REGRESSION: is gated behind sales:refund — a cashier is forbidden', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createCompletedFiscalSale(cashier.id, product.id);

    const res = await request(app)
      .post(`/api/sales/${sale.id}/debit-note`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({
        items: [{ saleItemId: sale.saleItems[0].id, quantity: 1 }],
        reason: 'Under-billed correction',
      });

    expect(res.status).toBe(403);
    expect(submitFiscalForDebitNoteSpy).not.toHaveBeenCalled();
  });

  it('REGRESSION: a manager can issue a debit note that reaches ZRA and completes', async () => {
    mockSuccessfulSubmission();
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createCompletedFiscalSale(manager.id, product.id);

    const res = await request(app)
      .post(`/api/sales/${sale.id}/debit-note`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({
        items: [{ saleItemId: sale.saleItems[0].id, quantity: 1, price: 100 }],
        reason: 'Under-billed correction',
        reasonCode: '01',
      });

    expect(res.status).toBe(201);
    expect(res.body.debitNote.status).toBe('COMPLETED');
    expect(res.body.debitNote.rcptNo).toBe('MOCK-DBT-1');
    expect(res.body.fiscal.success).toBe(true);
    expect(submitFiscalForDebitNoteSpy).toHaveBeenCalledWith(res.body.debitNote.id);

    const stored = await prisma.debitNote.findUnique({ where: { id: res.body.debitNote.id } });
    expect(stored.status).toBe('COMPLETED');
  });

  it('REGRESSION: surfaces a ZRA rejection as a 422 instead of a silent success', async () => {
    submitFiscalForDebitNoteSpy.mockResolvedValue({
      success: false,
      message: 'ZRA debit note submission failed: invalid item',
      code: '904',
    });
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createCompletedFiscalSale(manager.id, product.id);

    const res = await request(app)
      .post(`/api/sales/${sale.id}/debit-note`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ items: [{ saleItemId: sale.saleItems[0].id, quantity: 1, price: 100 }] });

    expect(res.status).toBe(422);
    expect(res.body.debitNote.status).toBe('FISCAL_FAILED');
    expect(res.body.debitNote.fiscalErrorCode).toBe('904');
  });

  it('REGRESSION: rejects a debit note against a sale that was never fiscalized', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createTestSale({ userId: manager.id, productId: product.id, status: 'PENDING' });

    const res = await request(app)
      .post(`/api/sales/${sale.id}/debit-note`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ items: [{ saleItemId: sale.saleItems[0].id, quantity: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/completed fiscal sale/i);
    expect(submitFiscalForDebitNoteSpy).not.toHaveBeenCalled();
  });

  it('REGRESSION: rejects a request with no adjustment lines', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createCompletedFiscalSale(manager.id, product.id);

    const res = await request(app)
      .post(`/api/sales/${sale.id}/debit-note`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ items: [] });

    expect(res.status).toBe(400);
    expect(submitFiscalForDebitNoteSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/sales/:id/debit-notes', () => {
  const app = createTestApp('/api/sales', salesRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    submitFiscalForDebitNoteSpy.mockReset();
    await cleanupTestData();
  });

  it('REGRESSION: lists debit notes issued against a sale', async () => {
    mockSuccessfulSubmission();
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createCompletedFiscalSale(manager.id, product.id);

    await request(app)
      .post(`/api/sales/${sale.id}/debit-note`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ items: [{ saleItemId: sale.saleItems[0].id, quantity: 1, price: 100 }] });

    const res = await request(app)
      .get(`/api/sales/${sale.id}/debit-notes`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].originalSaleId).toBe(sale.id);
  });
});
