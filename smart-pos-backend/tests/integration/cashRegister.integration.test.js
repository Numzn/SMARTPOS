import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import shiftLib from '../../lib/shift.js';
import saleFiscal from '../../lib/saleFiscal.js';
import saleRefund from '../../lib/saleRefund.js';

const {
  prisma,
  createTestBranch,
  createTestUser,
  createTestShift,
  createSellableProduct,
  createTestSale,
  cleanupTestData,
  DEFAULT_BRANCH_CODE,
} = testData;
const {
  openShift,
  recordCashMovement,
  endShift,
  closeShift,
  reopenShift,
  computeExpectedCash,
  getShiftReport,
  getOpenShiftForUser,
} = shiftLib;
const { completeSaleAfterFiscalSuccess } = saleFiscal;
const { completeRefundAfterFiscalSuccess, createPendingRefund } = saleRefund;

describe('Cash register / shift lifecycle', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('opens a shift with the given float and rejects a second open shift for the same user+branch', async () => {
    const user = await createTestUser();
    const shift = await openShift({ userId: user.id, branchId: DEFAULT_BRANCH_CODE, openingFloat: 50 });

    expect(shift.status).toBe('OPEN');
    expect(shift.openingFloat).toBe(50);

    await expect(
      openShift({ userId: user.id, branchId: DEFAULT_BRANCH_CODE, openingFloat: 20 })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects a negative opening float', async () => {
    const user = await createTestUser();
    await expect(
      openShift({ userId: user.id, branchId: DEFAULT_BRANCH_CODE, openingFloat: -10 })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('records cash-in/cash-out/paid-out and rejects invalid amounts', async () => {
    const user = await createTestUser();
    const shift = await createTestShift({ userId: user.id, openingFloat: 100 });

    await recordCashMovement(shift.id, { type: 'CASH_IN', amount: 50, userId: user.id, reason: 'change fund top-up' });
    await recordCashMovement(shift.id, { type: 'CASH_OUT', amount: 20, userId: user.id, reason: 'bank drop' });
    await recordCashMovement(shift.id, { type: 'PAID_OUT', amount: 15, userId: user.id, reason: 'supplier cash payment' });

    const movements = await prisma.shiftCashMovement.findMany({ where: { shiftId: shift.id } });
    expect(movements.length).toBe(3);

    await expect(
      recordCashMovement(shift.id, { type: 'CASH_IN', amount: -5, userId: user.id })
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      recordCashMovement(shift.id, { type: 'NOT_A_TYPE', amount: 5, userId: user.id })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects cash movements on an already-closed shift', async () => {
    const user = await createTestUser();
    const shift = await createTestShift({ userId: user.id, openingFloat: 0, status: 'CLOSED' });

    await expect(
      recordCashMovement(shift.id, { type: 'CASH_IN', amount: 10, userId: user.id })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('computes expected cash from float + cash sales - cash refunds + cash movements', async () => {
    const user = await createTestUser();
    const shift = await createTestShift({ userId: user.id, openingFloat: 100 });
    const product = await createSellableProduct({ stock: 10 });

    // A completed CASH sale of 3 units @ 100 (+16% tax) = 348, attributed to the shift.
    const sale = await createTestSale({
      userId: user.id,
      productId: product.id,
      quantity: 3,
      price: 100,
      shiftId: shift.id,
    });
    await completeSaleAfterFiscalSuccess(sale.id, { rcptNo: 'TEST-RCPT-CR-1' }, {}, DEFAULT_BRANCH_CODE);

    // A completed CARD sale must NOT affect the cash drawer at all.
    const cardSale = await createTestSale({
      userId: user.id,
      productId: product.id,
      quantity: 1,
      price: 100,
      shiftId: shift.id,
      paymentMethod: 'CARD',
    });
    await completeSaleAfterFiscalSuccess(cardSale.id, { rcptNo: 'TEST-RCPT-CR-2' }, {}, DEFAULT_BRANCH_CODE);

    await recordCashMovement(shift.id, { type: 'CASH_IN', amount: 30, userId: user.id });
    await recordCashMovement(shift.id, { type: 'CASH_OUT', amount: 10, userId: user.id });
    await recordCashMovement(shift.id, { type: 'PAID_OUT', amount: 5, userId: user.id });

    const breakdown = await computeExpectedCash(shift.id);

    expect(breakdown.openingFloat).toBe(100);
    expect(breakdown.cashSales).toBe(348); // 3 * 100 * 1.16, CARD sale excluded
    expect(breakdown.cashRefunds).toBe(0);
    expect(breakdown.cashIn).toBe(30);
    expect(breakdown.cashOut).toBe(10);
    expect(breakdown.paidOut).toBe(5);
    // 100 + 348 - 0 + 30 - 10 - 5 = 463
    expect(breakdown.expectedCash).toBe(463);
  });

  it('a completed cash refund reduces expected cash', async () => {
    const user = await createTestUser();
    const shift = await createTestShift({ userId: user.id, openingFloat: 0 });
    const product = await createSellableProduct({ stock: 10 });

    const sale = await createTestSale({
      userId: user.id,
      productId: product.id,
      quantity: 4,
      price: 100,
      shiftId: shift.id,
    });
    const completedSale = await completeSaleAfterFiscalSuccess(
      sale.id,
      { rcptNo: 'TEST-RCPT-CR-3' },
      {},
      DEFAULT_BRANCH_CODE
    );

    const pendingRefund = await createPendingRefund(completedSale.id, {
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ saleItemId: completedSale.saleItems[0].id, quantity: 1 }],
    });
    expect(pendingRefund.shiftId).toBe(shift.id);

    await completeRefundAfterFiscalSuccess(pendingRefund.id, { rcptNo: 'TEST-CREDIT-CR-1' }, {}, DEFAULT_BRANCH_CODE);

    const breakdown = await computeExpectedCash(shift.id);
    // 4 * 100 * 1.16 = 464 sold, 1 * 100 * 1.16 = 116 refunded => 348 net
    expect(breakdown.cashSales).toBe(464);
    expect(breakdown.cashRefunds).toBe(116);
    expect(breakdown.expectedCash).toBe(348);
  });

  it('closeShift computes variance (counted - expected) and marks the shift CLOSED', async () => {
    const user = await createTestUser();
    const reconciler = await createTestUser({ role: 'SUPERVISOR' });
    const shift = await createTestShift({ userId: user.id, openingFloat: 200 });

    const closed = await closeShift(shift.id, {
      countedCash: 195,
      reconcilerUserId: reconciler.id,
      notes: 'short by 5',
    });

    expect(closed.status).toBe('CLOSED');
    expect(closed.expectedCash).toBe(200);
    expect(closed.countedCash).toBe(195);
    expect(closed.variance).toBe(-5);
    expect(closed.closedAt).not.toBeNull();
    expect(closed.closedByUserId).toBe(reconciler.id);
  });

  it('rejects self-reconciliation regardless of who is passed as reconciler being the shift owner', async () => {
    const user = await createTestUser();
    const shift = await createTestShift({ userId: user.id, openingFloat: 100 });

    await expect(
      closeShift(shift.id, { countedCash: 100, reconcilerUserId: user.id })
    ).rejects.toMatchObject({ status: 403, code: 'SELF_RECONCILE_DENIED' });
  });

  it('rejects closing an already-closed shift and rejects a negative counted amount', async () => {
    const user = await createTestUser();
    const reconciler = await createTestUser({ role: 'SUPERVISOR' });
    const shift = await createTestShift({ userId: user.id, openingFloat: 0, status: 'CLOSED' });

    await expect(
      closeShift(shift.id, { countedCash: 10, reconcilerUserId: reconciler.id })
    ).rejects.toMatchObject({ status: 409 });

    const openShiftRow = await createTestShift({ userId: user.id, openingFloat: 0 });
    await expect(
      closeShift(openShiftRow.id, { countedCash: -1, reconcilerUserId: reconciler.id })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('endShift moves an OPEN shift to PENDING_RECONCILIATION and blocks further cash movements', async () => {
    const user = await createTestUser();
    const shift = await createTestShift({ userId: user.id, openingFloat: 50 });

    const ended = await endShift(shift.id, { userId: user.id });
    expect(ended.status).toBe('PENDING_RECONCILIATION');
    expect(ended.endedAt).not.toBeNull();

    await expect(
      recordCashMovement(shift.id, { type: 'CASH_IN', amount: 10, userId: user.id })
    ).rejects.toMatchObject({ status: 409 });

    await expect(endShift(shift.id, { userId: user.id })).rejects.toMatchObject({ status: 409 });
  });

  it('closeShift accepts a PENDING_RECONCILIATION shift (the normal end -> reconcile path)', async () => {
    const user = await createTestUser();
    const reconciler = await createTestUser({ role: 'SUPERVISOR' });
    const shift = await createTestShift({ userId: user.id, openingFloat: 50 });

    await endShift(shift.id, { userId: user.id });
    const closed = await closeShift(shift.id, { countedCash: 50, reconcilerUserId: reconciler.id });
    expect(closed.status).toBe('CLOSED');
  });

  it('reopenShift resets a CLOSED shift to PENDING_RECONCILIATION and clears the reconciliation figures', async () => {
    const user = await createTestUser();
    const reconciler = await createTestUser({ role: 'SUPERVISOR' });
    const shift = await createTestShift({ userId: user.id, openingFloat: 50 });
    await closeShift(shift.id, { countedCash: 50, reconcilerUserId: reconciler.id });

    const reopened = await reopenShift(shift.id, { notes: 'recount requested' });
    expect(reopened.status).toBe('PENDING_RECONCILIATION');
    expect(reopened.countedCash).toBeNull();
    expect(reopened.expectedCash).toBeNull();
    expect(reopened.variance).toBeNull();
    expect(reopened.closedAt).toBeNull();

    await expect(reopenShift(shift.id)).rejects.toMatchObject({ status: 409 });
  });

  it('getShiftReport returns cash + tender breakdowns, matching countedCash/variance once closed', async () => {
    const user = await createTestUser();
    const reconciler = await createTestUser({ role: 'SUPERVISOR' });
    const shift = await createTestShift({ userId: user.id, openingFloat: 50 });
    const product = await createSellableProduct({ stock: 10 });

    const sale = await createTestSale({
      userId: user.id,
      productId: product.id,
      quantity: 2,
      price: 100,
      shiftId: shift.id,
    });
    await completeSaleAfterFiscalSuccess(sale.id, { rcptNo: 'TEST-RCPT-CR-4' }, {}, DEFAULT_BRANCH_CODE);

    const xReport = await getShiftReport(shift.id);
    expect(xReport.shift.status).toBe('OPEN');
    expect(xReport.cash.expectedCash).toBe(50 + 232); // 2*100*1.16 = 232
    expect(xReport.saleCount).toBe(1);

    await closeShift(shift.id, { countedCash: 282, reconcilerUserId: reconciler.id });
    const zReport = await getShiftReport(shift.id);
    expect(zReport.shift.status).toBe('CLOSED');
    expect(zReport.cash.countedCash).toBe(282);
    expect(zReport.cash.variance).toBe(0);
  });

  it('checkout attribution: createPendingSale sets shiftId from the selling user\'s own open shift, and null when there is no open shift at all in the branch', async () => {
    const { createPendingSale } = saleFiscal;
    const userWithShift = await createTestUser();
    const shift = await openShift({ userId: userWithShift.id, branchId: DEFAULT_BRANCH_CODE, openingFloat: 0 });
    const product = await createSellableProduct({ stock: 10 });

    const saleWithShift = await createPendingSale({
      userId: userWithShift.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 1, price: 100 }],
    });
    expect(saleWithShift.shiftId).toBe(shift.id);

    // No open shift anywhere in the branch yet — nothing to fall back to.
    const userNoShiftAtAll = await createTestUser();
    await closeShift(shift.id, { countedCash: 0, reconcilerUserId: (await createTestUser({ role: 'SUPERVISOR' })).id });
    const saleWithNoBranchShift = await createPendingSale({
      userId: userNoShiftAtAll.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 1, price: 100 }],
    });
    expect(saleWithNoBranchShift.shiftId).toBeNull();
  });

  it('checkout attribution falls back to the branch\'s active shift for a Cashier who never opens their own (shifts:recordMovement, not shifts:operate)', async () => {
    const { createPendingSale } = saleFiscal;
    const opener = await createTestUser({ role: 'SUPERVISOR' });
    const shift = await openShift({ userId: opener.id, branchId: DEFAULT_BRANCH_CODE, openingFloat: 0 });
    const product = await createSellableProduct({ stock: 10 });

    const cashier = await createTestUser({ role: 'CASHIER' });
    const sale = await createPendingSale({
      userId: cashier.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 1, price: 100 }],
    });
    expect(sale.shiftId).toBe(shift.id);
  });

  it('getOpenShiftForUser only returns the OPEN shift for that user+branch', async () => {
    const user = await createTestUser();
    expect(await getOpenShiftForUser(user.id, DEFAULT_BRANCH_CODE)).toBeNull();

    const shift = await openShift({ userId: user.id, branchId: DEFAULT_BRANCH_CODE, openingFloat: 0 });
    const found = await getOpenShiftForUser(user.id, DEFAULT_BRANCH_CODE);
    expect(found.id).toBe(shift.id);

    const reconciler = await createTestUser({ role: 'SUPERVISOR' });
    await closeShift(shift.id, { countedCash: 0, reconcilerUserId: reconciler.id });
    expect(await getOpenShiftForUser(user.id, DEFAULT_BRANCH_CODE)).toBeNull();
  });
});
