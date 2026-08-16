import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import testData from '../helpers/testData.js';
import shiftLib from '../../lib/shift.js';
import approvalLib from '../../lib/approval.js';
import cashierDeclarationLib from '../../lib/cashierDeclaration.js';
import saleFiscal from '../../lib/saleFiscal.js';

const {
  prisma,
  createTestBranch,
  createTestUser,
  createTestProduct,
  createTestInventory,
  createTestBatch,
  createTestSale,
  cleanupTestData,
  DEFAULT_BRANCH_CODE,
} = testData;
const { openShift, recordCashMovement, endShift, closeShift, getShiftReport, getShiftTransactions } = shiftLib;
const { requestApproval } = approvalLib;
const { submitDeclaration } = cashierDeclarationLib;
const { completeSaleAfterFiscalSuccess } = saleFiscal;

async function hash(secret) {
  return bcrypt.hash(secret, 4); // low cost factor — tests only
}

/** Full end (PIN-gated) -> declare -> reconcile flow, returning the CLOSED shift. */
async function endAndReconcile(shiftId, { requesterUserId, approver, reconciler, declaredTotal, notes }) {
  const approval = await requestApproval(prisma, {
    approverUserId: approver.id,
    requesterUserId,
    credential: '1234',
    method: 'PIN',
    actionType: 'SHIFT_END',
    sessionId: null,
    target: { shiftId },
  });
  await endShift(shiftId, { approvalId: approval.id });
  await submitDeclaration(shiftId, { declaredByUserId: requesterUserId, declaredTotal });
  return closeShift(shiftId, { reconcilerUserId: reconciler.id, notes });
}

async function sellableProduct({ stock = 20, unitCost = 5 } = {}) {
  const product = await createTestProduct();
  await createTestInventory(product.id, { currentStock: stock });
  await createTestBatch(product.id, { quantity: stock, unitCost });
  return product;
}

describe('Shift X/Z reports and transaction journal', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('assigns a human-readable sequential shift number on open', async () => {
    const user = await createTestUser();
    const shift = await openShift({ userId: user.id, openingFloat: 100 });

    expect(shift.shiftNumber).toMatch(/^SHIFT-\d{6}$/);
  });

  it('X-report is a live snapshot that does not close or mutate the shift', async () => {
    const user = await createTestUser();
    const shift = await openShift({ userId: user.id, openingFloat: 200 });

    const first = await getShiftReport(shift.id);
    const second = await getShiftReport(shift.id);

    expect(first.shift.status).toBe('OPEN');
    expect(second.shift.status).toBe('OPEN');
    // Viewing it repeatedly must never advance any state.
    const stillOpen = await prisma.shift.findUnique({ where: { id: shift.id } });
    expect(stillOpen.status).toBe('OPEN');
    expect(stillOpen.closedAt).toBeNull();
    expect(stillOpen.countedCash).toBeNull();
  });

  it('X-report reports gross, discounts, net, tax and the payment breakdown', async () => {
    const user = await createTestUser();
    const product = await sellableProduct();
    const shift = await openShift({ userId: user.id, openingFloat: 50 });

    const sale = await createTestSale({
      userId: user.id,
      productId: product.id,
      quantity: 2,
      price: 100,
      shiftId: shift.id,
    });
    await completeSaleAfterFiscalSuccess(sale.id, { rcptNo: 'TEST-X-1' }, {}, DEFAULT_BRANCH_CODE);

    const report = await getShiftReport(shift.id);

    expect(report.shift.shiftNumber).toBeTruthy();
    expect(report.shift.durationMinutes).toBeGreaterThanOrEqual(0);
    expect(report.sales.netSales).toBe(200);
    expect(report.sales.grossSales).toBe(200); // no discount applied
    expect(report.sales.tax).toBe(32);
    expect(report.sales.transactionCount).toBe(1);
    expect(report.salesByMethod[0].paymentMethod).toBe('CASH');
    // Expected cash = float + cash sales
    expect(report.cash.expectedCash).toBe(50 + 232);
  });

  it('Z-report carries counted cash, variance and variance percentage', async () => {
    const user = await createTestUser();
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const reconciler = await createTestUser({ role: 'SUPERVISOR' });
    const shift = await openShift({ userId: user.id, openingFloat: 400 });
    await endAndReconcile(shift.id, { requesterUserId: user.id, approver, reconciler, declaredTotal: 380, notes: 'drawer short' });

    const report = await getShiftReport(shift.id);

    expect(report.shift.status).toBe('CLOSED');
    expect(report.shift.closedBy?.id).toBe(reconciler.id);
    expect(report.shift.closingNotes).toBe('drawer short');
    expect(report.cash.expectedCash).toBe(400);
    expect(report.cash.countedCash).toBe(380);
    expect(report.cash.variance).toBe(-20);
    expect(report.cash.variancePct).toBe(-5); // -20 / 400
  });

  it('journal merges sales, refunds and cash movements chronologically', async () => {
    const user = await createTestUser();
    const product = await sellableProduct();
    const shift = await openShift({ userId: user.id, openingFloat: 100 });

    const sale = await createTestSale({
      userId: user.id,
      productId: product.id,
      quantity: 1,
      price: 50,
      shiftId: shift.id,
    });
    await completeSaleAfterFiscalSuccess(sale.id, { rcptNo: 'TEST-J-1' }, {}, DEFAULT_BRANCH_CODE);
    await recordCashMovement(shift.id, { type: 'CASH_IN', amount: 75, reason: 'top-up', userId: user.id });
    await recordCashMovement(shift.id, { type: 'PAID_OUT', amount: 25, reason: 'courier', userId: user.id });

    const journal = await getShiftTransactions(shift.id);

    expect(journal.summary.total).toBe(3);
    expect(journal.summary.sales).toBe(1);
    expect(journal.summary.cashMovements).toBe(2);
    expect(journal.shift.shiftNumber).toBe(shift.shiftNumber);

    const paidOut = journal.transactions.find((t) => t.type === 'PAID_OUT');
    // Money leaving the drawer is negative so the column nets correctly.
    expect(paidOut.total).toBe(-25);
    const cashIn = journal.transactions.find((t) => t.type === 'CASH_IN');
    expect(cashIn.total).toBe(75);

    const saleRow = journal.transactions.find((t) => t.type === 'SALE');
    expect(saleRow.receiptNumber).toBe('TEST-J-1');
    expect(saleRow.total).toBe(58); // 50 + 16% tax
  });

  it('journal supports type filtering, search and sorting', async () => {
    const user = await createTestUser();
    const shift = await openShift({ userId: user.id, openingFloat: 100 });
    await recordCashMovement(shift.id, { type: 'CASH_IN', amount: 10, reason: 'alpha', userId: user.id });
    await recordCashMovement(shift.id, { type: 'CASH_OUT', amount: 90, reason: 'bravo', userId: user.id });

    const filtered = await getShiftTransactions(shift.id, { type: 'CASH_OUT' });
    expect(filtered.transactions.length).toBe(1);
    expect(filtered.transactions[0].type).toBe('CASH_OUT');
    // Summary describes the whole shift regardless of filter; only
    // filteredCount tracks the current view.
    expect(filtered.summary.total).toBe(2);
    expect(filtered.summary.filteredCount).toBe(1);
    expect(filtered.summary.cashMovements).toBe(2);

    const searched = await getShiftTransactions(shift.id, { search: 'alpha' });
    expect(searched.transactions.length).toBe(1);
    expect(searched.transactions[0].note).toBe('alpha');

    const sorted = await getShiftTransactions(shift.id, { sort: 'total_asc' });
    expect(sorted.transactions[0].total).toBe(-90); // cash out is most negative
  });

  it('journal 404s for a shift that does not exist', async () => {
    await expect(getShiftTransactions('no-such-shift')).rejects.toMatchObject({ status: 404 });
  });
});
