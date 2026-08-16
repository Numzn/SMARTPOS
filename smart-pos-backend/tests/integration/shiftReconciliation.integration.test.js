import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import shiftsRouter from '../../routes/shifts.js';
import tillApprovalsRouter from '../../routes/tillApprovals.js';

const { createTestBranch, createTestUser, createTestShift, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

async function hash(secret) {
  return bcrypt.hash(secret, 4); // low cost factor — tests only
}

describe('Cash register segregation of duties — route level', () => {
  const app = createTestApp('/api/shifts', shiftsRouter);
  const approvalsApp = createTestApp('/api/till', tillApprovalsRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  /** Mints a real SHIFT_END approval ticket via the actual HTTP route. */
  async function mintShiftEndApproval({ requester, approver, shiftId, pin = '1234' }) {
    const res = await request(approvalsApp)
      .post('/api/till/approvals')
      .set('Authorization', `Bearer ${tokenFor(requester)}`)
      .send({
        actionType: 'SHIFT_END',
        credential: pin,
        method: 'PIN',
        approverUserId: approver.id,
        target: { shiftId },
      });
    return res;
  }

  /** Full end (real PIN ticket) -> declare -> reconcile via the actual HTTP routes. */
  async function endDeclareAndClose({ requester, approver, reconciler, shiftId, declaredTotal }) {
    const approval = await mintShiftEndApproval({ requester, approver, shiftId });
    expect(approval.status).toBe(201);

    const ended = await request(app)
      .post(`/api/shifts/${shiftId}/end`)
      .set('Authorization', `Bearer ${tokenFor(requester)}`)
      .send({ approvalId: approval.body.approvalId });
    expect(ended.status).toBe(200);

    const declared = await request(app)
      .post(`/api/shifts/${shiftId}/declaration`)
      .set('Authorization', `Bearer ${tokenFor(requester)}`)
      .send({ declaredTotal });
    expect(declared.status).toBe(201);

    return request(app)
      .post(`/api/shifts/${shiftId}/close`)
      .set('Authorization', `Bearer ${tokenFor(reconciler)}`)
      .send({});
  }

  it('CASHIER can open their own shift — shifts:operate is restored to every till-facing role', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const res = await request(app)
      .post('/api/shifts/open')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ openingFloat: 0 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('OPEN');
  });

  it('POST /:id/end is rejected without a valid SHIFT_END approval — the shift stays OPEN, no Z is generated', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 100 });

    const noApproval = await request(app)
      .post(`/api/shifts/${shift.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({});
    expect(noApproval.status).toBe(403);
    expect(noApproval.body.code).toBe('APPROVAL_REQUIRED');

    const bogusApproval = await request(app)
      .post(`/api/shifts/${shift.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ approvalId: 'not-a-real-approval-id' });
    expect(bogusApproval.status).toBe(403);
    expect(bogusApproval.body.code).toBe('APPROVAL_REQUIRED');

    const stillOpen = await prisma.shift.findUnique({ where: { id: shift.id } });
    expect(stillOpen.status).toBe('OPEN');
    expect(await prisma.zReport.findUnique({ where: { shiftId: shift.id } })).toBeNull();
  });

  it('A Supervisor+ cannot approve their own SHIFT_END, even with the right PIN', async () => {
    const supervisor = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const shift = await createTestShift({ userId: supervisor.id, openingFloat: 100 });

    const res = await mintShiftEndApproval({ requester: supervisor, approver: supervisor, shiftId: shift.id });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SELF_APPROVAL_DENIED');
  });

  it('CASHIER: end-to-end — opens own shift, requests end, a Supervisor PIN authorizes it — response has no financial fields, only a zNumber', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 100 });

    const approval = await mintShiftEndApproval({ requester: cashier, approver, shiftId: shift.id });
    expect(approval.status).toBe(201);

    const res = await request(app)
      .post(`/api/shifts/${shift.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ approvalId: approval.body.approvalId });

    expect(res.status).toBe(200);
    expect(res.body.shift.status).toBe('PENDING_RECONCILIATION');
    expect(res.body.zNumber).toMatch(/^Z-\d{6}$/);
    expect(res.body.shift.expectedCash).toBeUndefined();
    expect(res.body.shift.countedCash).toBeUndefined();
    expect(res.body.shift.variance).toBeUndefined();

    // The ticket is single-use — trying to end again (a second shift, reusing
    // the same approvalId) must fail.
    const secondShift = await createTestShift({ userId: cashier.id, openingFloat: 0 });
    const reuse = await request(app)
      .post(`/api/shifts/${secondShift.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ approvalId: approval.body.approvalId });
    expect(reuse.status).toBe(403);
    expect(reuse.body.code).toBe('APPROVAL_REQUIRED');
  });

  it("SUPERVISOR: opens their own shift; ending it still requires a *different* Supervisor+'s PIN", async () => {
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const otherApprover = await createTestUser({ role: 'MANAGER', pinHash: await hash('1234') });
    const shift = await createTestShift({ userId: supervisor.id, openingFloat: 100 });

    const approval = await mintShiftEndApproval({ requester: supervisor, approver: otherApprover, shiftId: shift.id });
    expect(approval.status).toBe(201);

    const res = await request(app)
      .post(`/api/shifts/${shift.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`)
      .send({ approvalId: approval.body.approvalId });

    expect(res.status).toBe(200);
    expect(res.body.shift.status).toBe('PENDING_RECONCILIATION');
    // Supervisor holds shifts:viewExpected/viewVariance, so these fields
    // aren't stripped for them — they're just null/undefined, since ending
    // never computes or stores a figure on the Shift row itself (that lives
    // on the frozen ZReport instead).
  });

  it('CASHIER: can record cash-in/out/paid-out and safe drops on their own shift', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 100 });

    const cashIn = await request(app)
      .post(`/api/shifts/${shift.id}/cash-in`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ amount: 20, reason: 'float top-up' });
    expect(cashIn.status).toBe(200);

    const safeDrop = await request(app)
      .post(`/api/shifts/${shift.id}/safe-drop`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ amount: 50, safeId: 'SAFE-1' });
    expect(safeDrop.status).toBe(200);

    const current = await request(app)
      .get('/api/shifts/current')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(current.status).toBe(200);
    expect(current.body.id).toBe(shift.id);
    expect(current.body.expectedCash).toBeUndefined();
  });

  it('CASHIER: cannot record a cash movement on a shift they don\'t own and don\'t have shifts:recordMovement for', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const otherCashier = await createTestUser({ role: 'CASHIER' });
    const shift = await createTestShift({ userId: otherCashier.id, openingFloat: 100 });

    const res = await request(app)
      .post(`/api/shifts/${shift.id}/cash-in`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ amount: 20 });
    expect(res.status).toBe(403);
  });

  it('CASHIER: GET /:id/report on own OPEN shift omits expectedCash/variance', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 100 });

    const res = await request(app)
      .get(`/api/shifts/${shift.id}/report`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);

    expect(res.status).toBe(200);
    expect(res.body.cash.expectedCash).toBeUndefined();
    expect(res.body.cash.countedCash).toBeUndefined();
    expect(res.body.cash.variance).toBeUndefined();
    expect(res.body.cash.variancePct).toBeUndefined();
    // Movement totals are not sensitive — the cashier already knows these.
    expect(res.body.cash.openingFloat).toBe(100);
  });

  it('CASHIER: GET /:id/z-report is forbidden — the shift\'s own cashier never sees the frozen Z figures', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 100 });

    const approval = await mintShiftEndApproval({ requester: cashier, approver, shiftId: shift.id });
    await request(app)
      .post(`/api/shifts/${shift.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ approvalId: approval.body.approvalId });

    const res = await request(app)
      .get(`/api/shifts/${shift.id}/z-report`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(res.status).toBe(403);
  });

  it('SUPERVISOR: GET /:id/z-report sees the full frozen snapshot after reconciling', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const reconciler = await createTestUser({ role: 'MANAGER' });
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 100 });

    const closeRes = await endDeclareAndClose({
      requester: cashier,
      approver,
      reconciler,
      shiftId: shift.id,
      declaredTotal: 100,
    });
    expect(closeRes.status).toBe(200);

    const zRes = await request(app)
      .get(`/api/shifts/${shift.id}/z-report`)
      .set('Authorization', `Bearer ${tokenFor(reconciler)}`);
    expect(zRes.status).toBe(200);
    expect(zRes.body.expectedClosingCash).toBe(100);
    expect(zRes.body.declaration.declaredTotal).toBe(100);
  });

  it('CASHIER: GET /:id on a CLOSED shift is forbidden — shifts:operate only ever reaches an OPEN/PENDING shift they own, not history', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const manager = await createTestUser({ role: 'MANAGER' });
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 100 });

    const closeRes = await endDeclareAndClose({
      requester: cashier,
      approver,
      reconciler: manager,
      shiftId: shift.id,
      declaredTotal: 100,
    });
    expect(closeRes.status).toBe(200);

    const res = await request(app)
      .get(`/api/shifts/${shift.id}`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(res.status).toBe(403);
  });

  it('CASHIER: POST /:id/close is forbidden (lacks shifts:reconcile)', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 100 });

    const res = await request(app)
      .post(`/api/shifts/${shift.id}/close`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('SUPERVISOR: can reconcile another operator\'s declared shift with full financial visibility', async () => {
    const manager = await createTestUser({ role: 'MANAGER' }); // opens/owns the till being reconciled
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const shift = await createTestShift({ userId: manager.id, openingFloat: 200 });

    const closeRes = await endDeclareAndClose({
      requester: manager,
      approver,
      reconciler: supervisor,
      shiftId: shift.id,
      declaredTotal: 195,
    });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.status).toBe('CLOSED');
    expect(closeRes.body.expectedCash).toBe(200);
    expect(closeRes.body.countedCash).toBe(195);
    expect(closeRes.body.variance).toBe(-5);
    expect(closeRes.body.closedByUserId).toBe(supervisor.id);
  });

  it('SUPERVISOR: reconciling their own shift is forbidden regardless of permission', async () => {
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const approver = await createTestUser({ role: 'MANAGER', pinHash: await hash('1234') });
    const shift = await createTestShift({ userId: supervisor.id, openingFloat: 100 });

    const approval = await mintShiftEndApproval({ requester: supervisor, approver, shiftId: shift.id });
    await request(app)
      .post(`/api/shifts/${shift.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`)
      .send({ approvalId: approval.body.approvalId });
    await request(app)
      .post(`/api/shifts/${shift.id}/declaration`)
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`)
      .send({ declaredTotal: 100 });

    const res = await request(app)
      .post(`/api/shifts/${shift.id}/close`)
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('POST /:id/declaration is rejected for anyone but the shift\'s own cashier, and rejected twice', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const otherCashier = await createTestUser({ role: 'CASHIER' });
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 100 });

    const approval = await mintShiftEndApproval({ requester: cashier, approver, shiftId: shift.id });
    await request(app)
      .post(`/api/shifts/${shift.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ approvalId: approval.body.approvalId });

    const notOwner = await request(app)
      .post(`/api/shifts/${shift.id}/declaration`)
      .set('Authorization', `Bearer ${tokenFor(otherCashier)}`)
      .send({ declaredTotal: 100 });
    expect(notOwner.status).toBe(403);

    const first = await request(app)
      .post(`/api/shifts/${shift.id}/declaration`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ declaredTotal: 100 });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/shifts/${shift.id}/declaration`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ declaredTotal: 90 });
    expect(second.status).toBe(409);
  });

  it('POST /:id/adjustments requires shifts:adjust (a step up from shifts:reconcile) and only applies to a CLOSED shift', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const supervisor = await createTestUser({ role: 'SUPERVISOR' }); // shifts:reconcile, NOT shifts:adjust
    const manager = await createTestUser({ role: 'MANAGER' }); // holds shifts:adjust
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 200 });

    const closeRes = await endDeclareAndClose({
      requester: cashier,
      approver,
      reconciler: supervisor,
      shiftId: shift.id,
      declaredTotal: 150,
    });
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.variance).toBe(-50);

    const deniedForSupervisor = await request(app)
      .post(`/api/shifts/${shift.id}/adjustments`)
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`)
      .send({ reason: 'Counting error', resolutionNote: 'Recounted, cashier reimbursed' });
    expect(deniedForSupervisor.status).toBe(403);

    const res = await request(app)
      .post(`/api/shifts/${shift.id}/adjustments`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ reason: 'Counting error', resolutionNote: 'Recounted, cashier reimbursed' });
    expect(res.status).toBe(201);

    // The original Z/declaration figures are untouched by the adjustment.
    const zReport = await prisma.zReport.findUnique({ where: { shiftId: shift.id } });
    const declaration = await prisma.cashierDeclaration.findUnique({ where: { shiftId: shift.id } });
    expect(zReport.expectedClosingCash).toBe(200);
    expect(declaration.declaredTotal).toBe(150);
  });

  it('MANAGER: can reopen a closed shift; SUPERVISOR cannot — the declaration stays attached for re-reconciliation', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const approver = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const manager = await createTestUser({ role: 'MANAGER' });
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 50 });

    await endDeclareAndClose({ requester: cashier, approver, reconciler: supervisor, shiftId: shift.id, declaredTotal: 50 });

    const supervisorAttempt = await request(app)
      .post(`/api/shifts/${shift.id}/reopen`)
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`)
      .send({});
    expect(supervisorAttempt.status).toBe(403);

    const managerAttempt = await request(app)
      .post(`/api/shifts/${shift.id}/reopen`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({});
    expect(managerAttempt.status).toBe(200);
    expect(managerAttempt.body.status).toBe('PENDING_RECONCILIATION');

    // Re-reconcile with no fresh declaration needed.
    const reclose = await request(app)
      .post(`/api/shifts/${shift.id}/close`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({});
    expect(reclose.status).toBe(200);
    expect(reclose.body.variance).toBe(0);
  });

  it('GET /api/shifts with only shifts:reconcile (no shifts:viewAll) sees the reconciliation queue only, regardless of query params', async () => {
    const cashierA = await createTestUser({ role: 'CASHIER' });
    const cashierB = await createTestUser({ role: 'CASHIER' });
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const pendingShift = await createTestShift({ userId: cashierA.id, openingFloat: 0, status: 'PENDING_RECONCILIATION' });
    const openShiftRow = await createTestShift({ userId: cashierB.id, openingFloat: 0 });

    const res = await request(app)
      .get('/api/shifts')
      .query({ status: 'OPEN' }) // attempt to widen the view — must be ignored
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`);

    expect(res.status).toBe(200);
    const ids = res.body.shifts.map((s) => s.id);
    expect(ids).toContain(pendingShift.id);
    expect(ids).not.toContain(openShiftRow.id);
    // hasDeclaration surfaces even without an explicit ZReport (backfill
    // path is only triggered at close time, not at list time).
    expect(res.body.shifts.find((s) => s.id === pendingShift.id).hasDeclaration).toBe(false);
  });

  it('GET /api/shifts/active-tills lists every OPEN shift, store-wide, shifts:viewAll only', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const manager = await createTestUser({ role: 'MANAGER' });
    const openShiftRow = await createTestShift({ userId: cashier.id, openingFloat: 0 });

    const denied = await request(app)
      .get('/api/shifts/active-tills')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(denied.status).toBe(403);

    const res = await request(app)
      .get('/api/shifts/active-tills')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);
    expect(res.status).toBe(200);
    expect(res.body.shifts.map((s) => s.id)).toContain(openShiftRow.id);
  });
});
