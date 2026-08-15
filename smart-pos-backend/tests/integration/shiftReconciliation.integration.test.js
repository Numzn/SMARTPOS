import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import shiftsRouter from '../../routes/shifts.js';

const { createTestBranch, createTestUser, createTestShift, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

describe('Cash register segregation of duties — route level', () => {
  const app = createTestApp('/api/shifts', shiftsRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('REGRESSION: CASHIER cannot open a shift — shifts:operate is Supervisor+ only', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const res = await request(app)
      .post('/api/shifts/open')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ openingFloat: 0 });
    expect(res.status).toBe(403);
  });

  it('REGRESSION: CASHIER cannot end a shift, even one nominally "owned" by them — only Supervisor+ ends', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 100 });

    const res = await request(app)
      .post(`/api/shifts/${shift.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('SUPERVISOR: opens their own shift, then ends it — returns no financial fields', async () => {
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const shift = await createTestShift({ userId: supervisor.id, openingFloat: 100 });

    const res = await request(app)
      .post(`/api/shifts/${shift.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING_RECONCILIATION');
    // Supervisor holds shifts:viewExpected/viewVariance, so these fields
    // aren't stripped for them — they're just null, since endShift() never
    // computes or stores a figure (that's the reconciler's job at close).
    expect(res.body.expectedCash).toBeNull();
    expect(res.body.countedCash).toBeNull();
    expect(res.body.variance).toBeNull();
  });

  it('CASHIER: can record cash-in/out/paid-out on the branch\'s active shift opened by a Supervisor — shifts:recordMovement, not ownership', async () => {
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const cashier = await createTestUser({ role: 'CASHIER' });
    const shift = await createTestShift({ userId: supervisor.id, openingFloat: 100 });

    const cashIn = await request(app)
      .post(`/api/shifts/${shift.id}/cash-in`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ amount: 20, reason: 'float top-up' });
    expect(cashIn.status).toBe(200);

    const current = await request(app)
      .get('/api/shifts/current')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(current.status).toBe(200);
    expect(current.body.id).toBe(shift.id);
    expect(current.body.expectedCash).toBeUndefined();
  });

  it('CASHIER: cannot record a cash movement on a shift in a different branch', async () => {
    // A shared, idempotently-created reference branch — like ZraCode rows in
    // other test files, this is left in place rather than cleaned up per
    // test; it carries no per-test state of its own.
    await prisma.branch.upsert({
      where: { code: 'TEST-OTHER-BRANCH' },
      update: {},
      create: { code: 'TEST-OTHER-BRANCH', bhfId: '999', name: 'Other Branch', address: 'Test Address' },
    });
    const supervisor = await createTestUser({ role: 'SUPERVISOR', branchId: 'TEST-OTHER-BRANCH' });
    const cashier = await createTestUser({ role: 'CASHIER' }); // default branch
    const shift = await createTestShift({ userId: supervisor.id, openingFloat: 100, branchId: 'TEST-OTHER-BRANCH' });

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

  it('CASHIER: GET /:id on a CLOSED shift is forbidden — shifts:recordMovement only ever reaches the branch\'s currently active shift, not history', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const manager = await createTestUser({ role: 'MANAGER' });
    const shift = await createTestShift({ userId: supervisor.id, openingFloat: 100 });

    await request(app)
      .post(`/api/shifts/${shift.id}/close`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ countedCash: 100 });

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
      .send({ countedCash: 100 });

    expect(res.status).toBe(403);
  });

  it('SUPERVISOR: can reconcile another operator\'s PENDING_RECONCILIATION shift with full financial visibility', async () => {
    const manager = await createTestUser({ role: 'MANAGER' }); // opened/owns the till being reconciled
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const shift = await createTestShift({ userId: manager.id, openingFloat: 200 });

    // Supervisor's shifts:reconcile grants the override to end a shift it
    // doesn't own (e.g. an operator who forgot to end their own).
    await request(app)
      .post(`/api/shifts/${shift.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`)
      .send({});

    const closeRes = await request(app)
      .post(`/api/shifts/${shift.id}/close`)
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`)
      .send({ countedCash: 195 });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.status).toBe('CLOSED');
    expect(closeRes.body.expectedCash).toBe(200);
    expect(closeRes.body.countedCash).toBe(195);
    expect(closeRes.body.variance).toBe(-5);
    expect(closeRes.body.closedByUserId).toBe(supervisor.id);
  });

  it('SUPERVISOR: reconciling their own shift is forbidden regardless of permission', async () => {
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const shift = await createTestShift({ userId: supervisor.id, openingFloat: 100 });

    const res = await request(app)
      .post(`/api/shifts/${shift.id}/close`)
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`)
      .send({ countedCash: 100 });

    expect(res.status).toBe(403);
  });

  it('MANAGER: can reopen a closed shift; SUPERVISOR cannot', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const manager = await createTestUser({ role: 'MANAGER' });
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 50 });

    await request(app)
      .post(`/api/shifts/${shift.id}/close`)
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`)
      .send({ countedCash: 50 });

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
  });
});
