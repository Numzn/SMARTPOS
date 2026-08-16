import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import testData from '../helpers/testData.js';
import shiftLib from '../../lib/shift.js';
import approvalLib from '../../lib/approval.js';
import cashierDeclarationLib from '../../lib/cashierDeclaration.js';
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
const { requestApproval } = approvalLib;
const { submitDeclaration } = cashierDeclarationLib;
const { completeSaleAfterFiscalSuccess } = saleFiscal;
const { completeRefundAfterFiscalSuccess, createPendingRefund } = saleRefund;

async function hash(secret) {
  return bcrypt.hash(secret, 4); // low cost factor — tests only
}

/**
 * Mints a SHIFT_END approval ticket (approver must differ from the shift's
 * owner) and ends the shift. Returns lib/shift.js:endShift's { shift, zReport }.
 */
async function endShiftWithApproval(shiftId, approver) {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  const approval = await requestApproval(prisma, {
    approverUserId: approver.id,
    requesterUserId: shift.userId,
    credential: '1234',
    method: 'PIN',
    actionType: 'SHIFT_END',
    sessionId: null,
    target: { shiftId },
  });
  return endShift(shiftId, { approvalId: approval.id });
}

/** Full end -> declare -> reconcile flow, returning the CLOSED shift. */
async function endAndReconcile(shiftId, { approver, reconciler, declaredTotal }) {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  await endShiftWithApproval(shiftId, approver);
  await submitDeclaration(shiftId, { declaredByUserId: shift.userId, declaredTotal });
  return closeShift(shiftId, { reconcilerUserId: reconciler.id });
}

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

  it('records cash-in/cash-out/paid-out/safe-drop and rejects invalid amounts', async () => {
    const user = await createTestUser();
    const shift = await createTestShift({ userId: user.id, openingFloat: 100 });

    await recordCashMovement(shift.id, { type: 'CASH_IN', amount: 50, userId: user.id, reason: 'change fund top-up' });
    await recordCashMovement(shift.id, { type: 'CASH_OUT', amount: 20, userId: user.id, reason: 'petty cash' });
    await recordCashMovement(shift.id, { type: 'PAID_OUT', amount: 15, userId: user.id, reason: 'supplier cash payment' });
    await recordCashMovement(shift.id, { type: 'SAFE_DROP', amount: 25, userId: user.id, safeId: 'SAFE-1' });

    const movements = await prisma.shiftCashMovement.findMany({ where: { shiftId: shift.id } });
    expect(movements.length).toBe(4);
    expect(movements.find((m) => m.type === 'SAFE_DROP').safeId).toBe('SAFE-1');

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

  it('computes expected cash from float + cash sales - cash refunds + cash movements, including safe drops', async () => {
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
    await recordCashMovement(shift.id, { type: 'SAFE_DROP', amount: 40, userId: user.id });

    const breakdown = await computeExpectedCash(shift.id);

    expect(breakdown.openingFloat).toBe(100);
    expect(breakdown.cashSales).toBe(348); // 3 * 100 * 1.16, CARD sale excluded
    expect(breakdown.cashRefunds).toBe(0);
    expect(breakdown.cashIn).toBe(30);
    expect(breakdown.cashOut).toBe(10);
    expect(breakdown.paidOut).toBe(5);
    expect(breakdown.safeDropsTotal).toBe(40);
    // 100 + 348 - 0 + 30 - 10 - 5 - 40 = 423
    expect(breakdown.expectedCash).toBe(423);
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

  it('endShift requires a valid SHIFT_END approval — mints a ZReport freezing expectedCash, moves the shift to PENDING_RECONCILIATION, and blocks further cash movements', async () => {
    const user = await createTestUser();
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const shift = await createTestShift({ userId: user.id, openingFloat: 50 });

    const { shift: ended, zReport } = await endShiftWithApproval(shift.id, approver);
    expect(ended.status).toBe('PENDING_RECONCILIATION');
    expect(ended.endedAt).not.toBeNull();
    expect(zReport.zNumber).toMatch(/^Z-\d{6}$/);
    expect(zReport.expectedClosingCash).toBe(50);
    expect(zReport.authorizedByUserId).toBe(approver.id);
    expect(zReport.backfilled).toBe(false);

    await expect(
      recordCashMovement(shift.id, { type: 'CASH_IN', amount: 10, userId: user.id })
    ).rejects.toMatchObject({ status: 409 });

    await expect(endShiftWithApproval(shift.id, approver)).rejects.toMatchObject({ status: 409 });
  });

  it('endShift rejects a missing/invalid/self approval', async () => {
    const user = await createTestUser();
    const shift = await createTestShift({ userId: user.id, openingFloat: 50 });

    await expect(endShift(shift.id, { approvalId: null })).rejects.toMatchObject({
      status: 403,
      code: 'APPROVAL_REQUIRED',
    });
    await expect(endShift(shift.id, { approvalId: 'not-a-real-id' })).rejects.toMatchObject({
      status: 403,
      code: 'APPROVAL_REQUIRED',
    });

    // The shift's own owner cannot approve their own SHIFT_END, even with a
    // real PIN — requestApproval blocks self-approval unconditionally.
    await createTestUser({ role: 'SUPERVISOR' }); // unrelated user, keeps role distribution realistic
    await expect(
      requestApproval(prisma, {
        approverUserId: user.id,
        requesterUserId: user.id,
        credential: '1234',
        method: 'PIN',
        actionType: 'SHIFT_END',
        sessionId: null,
        target: { shiftId: shift.id },
      })
    ).rejects.toMatchObject({ status: 403, code: 'SELF_APPROVAL_DENIED' });
  });

  it('closeShift requires PENDING_RECONCILIATION status and a submitted declaration', async () => {
    const user = await createTestUser();
    const reconciler = await createTestUser({ role: 'SUPERVISOR' });
    const openShiftRow = await createTestShift({ userId: user.id, openingFloat: 0 });

    // Still OPEN — hasn't been through endShift yet.
    await expect(
      closeShift(openShiftRow.id, { reconcilerUserId: reconciler.id })
    ).rejects.toMatchObject({ status: 409 });

    const closedShiftRow = await createTestShift({ userId: user.id, openingFloat: 0, status: 'CLOSED' });
    await expect(
      closeShift(closedShiftRow.id, { reconcilerUserId: reconciler.id })
    ).rejects.toMatchObject({ status: 409 });

    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const pendingShift = await createTestShift({ userId: user.id, openingFloat: 0 });
    await endShiftWithApproval(pendingShift.id, approver);
    // Ended, but no declaration submitted yet.
    await expect(
      closeShift(pendingShift.id, { reconcilerUserId: reconciler.id })
    ).rejects.toMatchObject({ status: 409, code: 'DECLARATION_REQUIRED' });
  });

  it('rejects self-reconciliation regardless of who is passed as reconciler being the shift owner', async () => {
    const user = await createTestUser();
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const shift = await createTestShift({ userId: user.id, openingFloat: 100 });
    await endShiftWithApproval(shift.id, approver);

    await expect(
      closeShift(shift.id, { reconcilerUserId: user.id })
    ).rejects.toMatchObject({ status: 403, code: 'SELF_RECONCILE_DENIED' });
  });

  it('submitDeclaration rejects a negative total, a second submission, and a non-owner submitter', async () => {
    const user = await createTestUser();
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const shift = await createTestShift({ userId: user.id, openingFloat: 50 });
    await endShiftWithApproval(shift.id, approver);

    await expect(
      submitDeclaration(shift.id, { declaredByUserId: user.id, declaredTotal: -1 })
    ).rejects.toMatchObject({ status: 400 });

    const other = await createTestUser();
    await expect(
      submitDeclaration(shift.id, { declaredByUserId: other.id, declaredTotal: 50 })
    ).rejects.toMatchObject({ status: 403 });

    await submitDeclaration(shift.id, { declaredByUserId: user.id, declaredTotal: 50 });
    await expect(
      submitDeclaration(shift.id, { declaredByUserId: user.id, declaredTotal: 45 })
    ).rejects.toMatchObject({ status: 409, code: 'DECLARATION_ALREADY_SUBMITTED' });
  });

  it('closeShift computes variance (declared - frozen expected) from the ZReport + declaration, and marks the shift CLOSED', async () => {
    const user = await createTestUser();
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const reconciler = await createTestUser({ role: 'SUPERVISOR' });
    const shift = await createTestShift({ userId: user.id, openingFloat: 200 });

    const closed = await endAndReconcile(shift.id, { approver, reconciler, declaredTotal: 195 });

    expect(closed.status).toBe('CLOSED');
    expect(closed.expectedCash).toBe(200);
    expect(closed.countedCash).toBe(195);
    expect(closed.variance).toBe(-5);
    expect(closed.closedAt).not.toBeNull();
    expect(closed.closedByUserId).toBe(reconciler.id);
  });

  it('reopenShift resets a CLOSED shift to PENDING_RECONCILIATION, clears the reconciliation figures, but keeps the ZReport and declaration intact for re-reconciliation', async () => {
    const user = await createTestUser();
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const reconciler = await createTestUser({ role: 'SUPERVISOR' });
    const shift = await createTestShift({ userId: user.id, openingFloat: 50 });
    await endAndReconcile(shift.id, { approver, reconciler, declaredTotal: 50 });

    const reopened = await reopenShift(shift.id, { notes: 'recount requested' });
    expect(reopened.status).toBe('PENDING_RECONCILIATION');
    expect(reopened.countedCash).toBeNull();
    expect(reopened.expectedCash).toBeNull();
    expect(reopened.variance).toBeNull();
    expect(reopened.closedAt).toBeNull();

    // The original ZReport/declaration are untouched — re-reconciling needs
    // no fresh declaration, just closeShift() again.
    const zReport = await prisma.zReport.findUnique({ where: { shiftId: shift.id } });
    const declaration = await prisma.cashierDeclaration.findUnique({ where: { shiftId: shift.id } });
    expect(zReport.expectedClosingCash).toBe(50);
    expect(declaration.declaredTotal).toBe(50);

    const reclosed = await closeShift(shift.id, { reconcilerUserId: reconciler.id });
    expect(reclosed.status).toBe('CLOSED');
    expect(reclosed.variance).toBe(0);

    await expect(reopenShift('does-not-exist')).rejects.toMatchObject({ status: 404 });
  });

  it('getShiftReport shows the live cashBreakdown pre-Z, then the frozen ZReport figures once ended and reconciled', async () => {
    const user = await createTestUser();
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
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
    expect(xReport.shift.zNumber).toBeNull();
    expect(xReport.cash.expectedCash).toBe(50 + 232); // 2*100*1.16 = 232
    expect(xReport.saleCount).toBe(1);

    await endAndReconcile(shift.id, { approver, reconciler, declaredTotal: 282 });
    const zReportView = await getShiftReport(shift.id);
    expect(zReportView.shift.status).toBe('CLOSED');
    expect(zReportView.shift.zNumber).toMatch(/^Z-\d{6}$/);
    expect(zReportView.cash.expectedCash).toBe(282);
    expect(zReportView.cash.countedCash).toBe(282);
    expect(zReportView.cash.variance).toBe(0);
  });

  it('checkout attribution: createPendingSale sets shiftId from the selling user\'s own open shift, and null when there is no open shift at all in the branch', async () => {
    const { createPendingSale } = saleFiscal;
    const userWithShift = await createTestUser();
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const reconciler = await createTestUser({ role: 'SUPERVISOR' });
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
    await endAndReconcile(shift.id, { approver, reconciler, declaredTotal: 0 });
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

    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const reconciler = await createTestUser({ role: 'SUPERVISOR' });
    await endAndReconcile(shift.id, { approver, reconciler, declaredTotal: 0 });
    expect(await getOpenShiftForUser(user.id, DEFAULT_BRANCH_CODE)).toBeNull();
  });

  it('closeShift auto-backfills a ZReport for a shift that reached PENDING_RECONCILIATION without one (pre-existing data, no PIN-gated endShift ever ran)', async () => {
    const user = await createTestUser();
    const reconciler = await createTestUser({ role: 'SUPERVISOR' });
    // Simulates a shift from before this feature shipped: PENDING_RECONCILIATION,
    // no ZReport row, created directly rather than via endShift().
    const shift = await createTestShift({ userId: user.id, openingFloat: 75, status: 'PENDING_RECONCILIATION' });
    await submitDeclaration(shift.id, { declaredByUserId: user.id, declaredTotal: 75 });

    // submitDeclaration() itself backfills the missing ZReport (it can't
    // create a CashierDeclaration without one — zReportId is a required FK),
    // attributed to the cashier as a placeholder since authorizedByUserId is
    // required and no supervisor/reconciler is involved in that flow.
    const backfilledAtDeclaration = await prisma.zReport.findUnique({ where: { shiftId: shift.id } });
    expect(backfilledAtDeclaration.backfilled).toBe(true);
    expect(backfilledAtDeclaration.authorizedByUserId).toBe(user.id);

    const closed = await closeShift(shift.id, { reconcilerUserId: reconciler.id });
    expect(closed.status).toBe('CLOSED');
    expect(closed.expectedCash).toBe(75);
    expect(closed.variance).toBe(0);

    // closeShift() reassigns attribution to the reconciler taking
    // responsibility for the backfilled Z, superseding the cashier placeholder.
    const zReport = await prisma.zReport.findUnique({ where: { shiftId: shift.id } });
    expect(zReport.backfilled).toBe(true);
    expect(zReport.supervisorApprovalId).toBeNull();
    expect(zReport.authorizedByUserId).toBe(reconciler.id);
  });
});
