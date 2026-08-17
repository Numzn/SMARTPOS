import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import shiftLib from '../../lib/shift.js';
import shiftsRouter from '../../routes/shifts.js';

const { createTestBranch, createTestUser, createTestShift, cleanupTestData, prisma, DEFAULT_BRANCH_CODE } = testData;
const { ensureShiftForLogin, confirmOpeningCash, cancelInitializingShift, getActiveShiftForUser } = shiftLib;
const { createTestApp } = testApp;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

describe('Shift initialization — auto-created on login, race-safe', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('creates a fresh shift as INITIALIZING for a user with none active', async () => {
    const user = await createTestUser();
    const shift = await ensureShiftForLogin(user.id, DEFAULT_BRANCH_CODE);
    expect(shift.status).toBe('INITIALIZING');
    expect(shift.userId).toBe(user.id);
    expect(shift.shiftNumber).toMatch(/^SHIFT-/);
  });

  it('is idempotent — a second call resumes the same INITIALIZING shift rather than creating another', async () => {
    const user = await createTestUser();
    const first = await ensureShiftForLogin(user.id, DEFAULT_BRANCH_CODE);
    const second = await ensureShiftForLogin(user.id, DEFAULT_BRANCH_CODE);
    expect(second.id).toBe(first.id);

    const rows = await prisma.shift.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
  });

  it('resumes an existing OPEN shift too, not just INITIALIZING', async () => {
    const user = await createTestUser();
    const openShift = await createTestShift({ userId: user.id, status: 'OPEN', openingFloat: 100 });
    const resumed = await ensureShiftForLogin(user.id, DEFAULT_BRANCH_CODE);
    expect(resumed.id).toBe(openShift.id);
    expect(resumed.status).toBe('OPEN');
  });

  it('REGRESSION: concurrent ensureShiftForLogin calls for the same user never create two shifts — the partial unique index, not application code, is what makes this safe', async () => {
    const user = await createTestUser();
    // Ten simultaneous "login" requests — double-click, two tabs, a retried
    // request all collapse into this same shape.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => ensureShiftForLogin(user.id, DEFAULT_BRANCH_CODE))
    );
    const ids = new Set(results.map((s) => s.id));
    expect(ids.size).toBe(1);

    const rows = await prisma.shift.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
  });

  it('REGRESSION: the shifts_active_user_branch_key partial index exists — its absence would silently reopen the race condition above', async () => {
    const rows = await prisma.$queryRaw`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'shifts_active_user_branch_key'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('"userId"');
    expect(rows[0].indexdef).toContain('"branchId"');
  });

  describe('confirmOpeningCash', () => {
    it('transitions INITIALIZING -> OPEN, sets the opening float, and resets openedAt to the confirmation moment', async () => {
      const user = await createTestUser();
      const initializing = await ensureShiftForLogin(user.id, DEFAULT_BRANCH_CODE);
      const before = new Date();

      const confirmed = await confirmOpeningCash(initializing.id, {
        userId: user.id,
        openingFloat: 250,
        notes: 'counted twice',
      });

      expect(confirmed.status).toBe('OPEN');
      expect(confirmed.openingFloat).toBe(250);
      expect(confirmed.openingNotes).toBe('counted twice');
      expect(new Date(confirmed.openedAt).getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('rejects a non-owner (403)', async () => {
      const owner = await createTestUser();
      const someoneElse = await createTestUser();
      const initializing = await ensureShiftForLogin(owner.id, DEFAULT_BRANCH_CODE);

      await expect(
        confirmOpeningCash(initializing.id, { userId: someoneElse.id, openingFloat: 100 })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('rejects confirming a shift that is not INITIALIZING (409)', async () => {
      const user = await createTestUser();
      const openShift = await createTestShift({ userId: user.id, status: 'OPEN', openingFloat: 50 });

      await expect(
        confirmOpeningCash(openShift.id, { userId: user.id, openingFloat: 75 })
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('cancelInitializingShift — the escape hatch for a stuck shift', () => {
    it('deletes an INITIALIZING shift, freeing the user to get a new one', async () => {
      const user = await createTestUser();
      const stuck = await ensureShiftForLogin(user.id, DEFAULT_BRANCH_CODE);

      await cancelInitializingShift(stuck.id);

      expect(await getActiveShiftForUser(user.id, DEFAULT_BRANCH_CODE)).toBeNull();
      const fresh = await ensureShiftForLogin(user.id, DEFAULT_BRANCH_CODE);
      expect(fresh.id).not.toBe(stuck.id);
      expect(fresh.status).toBe('INITIALIZING');
    });

    it('rejects cancelling a shift that is not INITIALIZING (409)', async () => {
      const user = await createTestUser();
      const openShift = await createTestShift({ userId: user.id, status: 'OPEN', openingFloat: 10 });

      await expect(cancelInitializingShift(openShift.id)).rejects.toMatchObject({ status: 409 });
    });
  });
});

describe('Shift initialization — route level', () => {
  const app = createTestApp('/api/shifts', shiftsRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('POST /ensure requires shifts:operate', async () => {
    const viewer = await createTestUser({ role: 'VIEWER' });
    const res = await request(app).post('/api/shifts/ensure').set('Authorization', `Bearer ${tokenFor(viewer)}`);
    expect(res.status).toBe(403);
  });

  it('POST /ensure then POST /:id/confirm-opening completes the flow, and Cash In is rejected until confirmed', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });

    const ensured = await request(app).post('/api/shifts/ensure').set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(ensured.status).toBe(200);
    expect(ensured.body.status).toBe('INITIALIZING');

    const blockedMovement = await request(app)
      .post(`/api/shifts/${ensured.body.id}/cash-in`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ amount: 20 });
    expect(blockedMovement.status).toBe(409);

    const confirmed = await request(app)
      .post(`/api/shifts/${ensured.body.id}/confirm-opening`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ openingFloat: 150, notes: 'opening' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('OPEN');

    const allowedMovement = await request(app)
      .post(`/api/shifts/${ensured.body.id}/cash-in`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ amount: 20 });
    expect(allowedMovement.status).toBe(200);
  });

  it('POST /:id/confirm-opening is rejected for a different cashier (403)', async () => {
    const owner = await createTestUser({ role: 'CASHIER' });
    const someoneElse = await createTestUser({ role: 'CASHIER' });
    const ensured = await request(app).post('/api/shifts/ensure').set('Authorization', `Bearer ${tokenFor(owner)}`);

    const res = await request(app)
      .post(`/api/shifts/${ensured.body.id}/confirm-opening`)
      .set('Authorization', `Bearer ${tokenFor(someoneElse)}`)
      .send({ openingFloat: 100 });
    expect(res.status).toBe(403);
  });

  it('POST /:id/cancel-initialization requires shifts:reopen, not just shifts:operate', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const ensured = await request(app).post('/api/shifts/ensure').set('Authorization', `Bearer ${tokenFor(cashier)}`);

    const deniedForSelf = await request(app)
      .post(`/api/shifts/${ensured.body.id}/cancel-initialization`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(deniedForSelf.status).toBe(403);

    const admin = await createTestUser({ role: 'ADMIN' });
    const cancelled = await request(app)
      .post(`/api/shifts/${ensured.body.id}/cancel-initialization`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.cancelled).toBe(true);
  });

  it('GET /active-tills lists an INITIALIZING shift alongside OPEN ones', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const admin = await createTestUser({ role: 'ADMIN' });
    const ensured = await request(app).post('/api/shifts/ensure').set('Authorization', `Bearer ${tokenFor(cashier)}`);

    const res = await request(app).get('/api/shifts/active-tills').set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    const row = res.body.shifts.find((s) => s.id === ensured.body.id);
    expect(row).toBeTruthy();
    expect(row.status).toBe('INITIALIZING');
  });
});
