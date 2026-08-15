import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import shiftsRouter from '../../routes/shifts.js';

const { createTestBranch, createTestUser, createTestShift, cleanupTestData } = testData;
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

  it('CASHIER: POST /:id/end succeeds and returns no financial fields', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 100 });

    const res = await request(app)
      .post(`/api/shifts/${shift.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING_RECONCILIATION');
    expect(res.body.expectedCash).toBeUndefined();
    expect(res.body.countedCash).toBeUndefined();
    expect(res.body.variance).toBeUndefined();
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

  it('CASHIER: GET /:id omits expectedCash/countedCash/variance even once the shift is closed', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 100 });

    await request(app)
      .post(`/api/shifts/${shift.id}/close`)
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`)
      .send({ countedCash: 100 });

    const res = await request(app)
      .get(`/api/shifts/${shift.id}`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);

    expect(res.status).toBe(200);
    expect(res.body.expectedCash).toBeUndefined();
    expect(res.body.countedCash).toBeUndefined();
    expect(res.body.variance).toBeUndefined();
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

  it('SUPERVISOR: can reconcile another cashier\'s PENDING_RECONCILIATION shift with full financial visibility', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const shift = await createTestShift({ userId: cashier.id, openingFloat: 200 });

    await request(app)
      .post(`/api/shifts/${shift.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
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
