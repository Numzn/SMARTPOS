import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import shiftRoutes from '../../routes/shifts.js';
import tillApprovalsRouter from '../../routes/tillApprovals.js';

const {
  createTestBranch,
  createTestUser,
  createTestRegister,
  createTestTill,
  cleanupTestData,
  DEFAULT_BRANCH_CODE,
} = testData;
const { createTestApp } = testApp;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

async function hash(secret) {
  return bcrypt.hash(secret, 4); // low cost factor — tests only
}

async function setupTill(defaultOpeningFloat = 0) {
  await createTestBranch();
  const register = await createTestRegister({ branchId: DEFAULT_BRANCH_CODE });
  return createTestTill({ registerId: register.id, defaultOpeningFloat });
}

describe('routes/shifts — V1 register/till model (open-for-till, handover, current-cashier)', () => {
  const app = createTestApp('/api/shifts', shiftRoutes);
  const approvalsApp = createTestApp('/api/till', tillApprovalsRouter);

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
    expect(res.status).toBe(201);
    return res.body.approvalId;
  }

  it('POST /open-for-till requires shifts:operate — a viewer is forbidden', async () => {
    const till = await setupTill();
    const viewer = await createTestUser({ role: 'VIEWER' });
    const res = await request(app)
      .post('/api/shifts/open-for-till')
      .set('Authorization', `Bearer ${tokenFor(viewer)}`)
      .send({ tillId: till.id });
    expect(res.status).toBe(403);
  });

  it('a cashier can open a shift for a till, using its configured default opening float', async () => {
    const till = await setupTill(350);
    const alice = await createTestUser({ role: 'CASHIER' });

    const res = await request(app)
      .post('/api/shifts/open-for-till')
      .set('Authorization', `Bearer ${tokenFor(alice)}`)
      .send({ tillId: till.id });

    expect(res.status).toBe(201);
    expect(res.body.openingFloat).toBe(350);
    expect(res.body.tillId).toBe(till.id);
  });

  it('handover: Alice opens, hands over to Brian; the shift stays open and Brian is the new current cashier', async () => {
    const till = await setupTill(100);
    const alice = await createTestUser({ role: 'CASHIER' });
    const brian = await createTestUser({ role: 'CASHIER' });

    const openRes = await request(app)
      .post('/api/shifts/open-for-till')
      .set('Authorization', `Bearer ${tokenFor(alice)}`)
      .send({ tillId: till.id, declaredOpeningCash: 100 });
    const shiftId = openRes.body.id;

    const handoverRes = await request(app)
      .post(`/api/shifts/${shiftId}/handover`)
      .set('Authorization', `Bearer ${tokenFor(alice)}`)
      .send({ toUserId: brian.id, declaredTotal: 100 });

    expect(handoverRes.status).toBe(201);
    expect(handoverRes.body.declaration.variance).toBe(0);

    const currentRes = await request(app)
      .get(`/api/shifts/${shiftId}/current-cashier`)
      .set('Authorization', `Bearer ${tokenFor(brian)}`);
    expect(currentRes.status).toBe(200);
    expect(currentRes.body.userId).toBe(brian.id);

    // The shift itself never closed — requirement: a declaration doesn't
    // close the shift, only an explicit end/close does.
    const afterRes = await request(app)
      .get(`/api/shifts/${shiftId}`)
      .set('Authorization', `Bearer ${tokenFor(brian)}`);
    expect(afterRes.body.status).toBe('OPEN');
  });

  it('handover is rejected when attempted by someone other than the current cashier', async () => {
    const till = await setupTill();
    const alice = await createTestUser({ role: 'CASHIER' });
    const brian = await createTestUser({ role: 'CASHIER' });
    const mallory = await createTestUser({ role: 'CASHIER' });

    const openRes = await request(app)
      .post('/api/shifts/open-for-till')
      .set('Authorization', `Bearer ${tokenFor(alice)}`)
      .send({ tillId: till.id });

    const res = await request(app)
      .post(`/api/shifts/${openRes.body.id}/handover`)
      .set('Authorization', `Bearer ${tokenFor(mallory)}`)
      .send({ toUserId: brian.id, declaredTotal: 0 });
    expect(res.status).toBe(403);
  });

  it('GET /current resolves to the shift for whoever the current ShiftCashier is after a handover, not who opened it', async () => {
    const till = await setupTill();
    const alice = await createTestUser({ role: 'CASHIER' });
    const brian = await createTestUser({ role: 'CASHIER' });

    const openRes = await request(app)
      .post('/api/shifts/open-for-till')
      .set('Authorization', `Bearer ${tokenFor(alice)}`)
      .send({ tillId: till.id });

    await request(app)
      .post(`/api/shifts/${openRes.body.id}/handover`)
      .set('Authorization', `Bearer ${tokenFor(alice)}`)
      .send({ toUserId: brian.id, declaredTotal: 0 });

    const currentForBrian = await request(app)
      .get('/api/shifts/current')
      .set('Authorization', `Bearer ${tokenFor(brian)}`);
    expect(currentForBrian.status).toBe(200);
    expect(currentForBrian.body.id).toBe(openRes.body.id);

    // Alice's turn already ended — GET /current no longer finds it for her.
    const currentForAlice = await request(app)
      .get('/api/shifts/current')
      .set('Authorization', `Bearer ${tokenFor(alice)}`);
    expect(currentForAlice.status).toBe(404);
  });

  it('GET /registers lists registers (with their tills) for a plain cashier — shifts:operate, not settings:read', async () => {
    const register = await createTestRegister({ branchId: DEFAULT_BRANCH_CODE });
    await createTestTill({ registerId: register.id, defaultOpeningFloat: 500 });
    const cashier = await createTestUser({ role: 'CASHIER' });

    const res = await request(app)
      .get('/api/shifts/registers')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(res.status).toBe(200);
    const found = res.body.find((r) => r.id === register.id);
    expect(found.tills[0].defaultOpeningFloat).toBe(500);
  });

  it('GET /by-till/:tillId 404s when idle, then returns the shift once one is open', async () => {
    const till = await setupTill();
    const cashier = await createTestUser({ role: 'CASHIER' });

    const idleRes = await request(app)
      .get(`/api/shifts/by-till/${till.id}`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(idleRes.status).toBe(404);

    const openRes = await request(app)
      .post('/api/shifts/open-for-till')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ tillId: till.id });

    const activeRes = await request(app)
      .get(`/api/shifts/by-till/${till.id}`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(activeRes.status).toBe(200);
    expect(activeRes.body.id).toBe(openRes.body.id);
  });

  it('GET /handover-candidates excludes the requester and lists operate-eligible roles only', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const other = await createTestUser({ role: 'CASHIER' });
    const viewer = await createTestUser({ role: 'VIEWER' });

    const res = await request(app)
      .get('/api/shifts/handover-candidates')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(res.status).toBe(200);
    const ids = res.body.candidates.map((c) => c.id);
    expect(ids).toContain(other.id);
    expect(ids).not.toContain(cashier.id); // can't hand over to yourself
    expect(ids).not.toContain(viewer.id); // not operate-eligible
  });

  // Corrective work: canRecordMovement(), the /:id/end ownership check, and
  // submitDeclaration() all used to authorize against shift.userId — the
  // ORIGINAL opener — which broke every one of these actions for a cashier
  // who received a handover. They now resolve through isAuthorizedCashier()
  // (lib/shift.js), which follows the current ShiftCashier turn instead.
  // These tests prove the full write-action surface tracks the CURRENT
  // cashier through a multi-hop chain, not "any previous cashier."
  describe('write-action authorization follows the current ShiftCashier, not shift.userId', () => {
    it('Test A — the original opener (no handover yet) can perform normal cashier operations', async () => {
      const till = await setupTill(100);
      const alice = await createTestUser({ role: 'CASHIER' });

      const openRes = await request(app)
        .post('/api/shifts/open-for-till')
        .set('Authorization', `Bearer ${tokenFor(alice)}`)
        .send({ tillId: till.id, declaredOpeningCash: 100 });
      const shiftId = openRes.body.id;

      const cashIn = await request(app)
        .post(`/api/shifts/${shiftId}/cash-in`)
        .set('Authorization', `Bearer ${tokenFor(alice)}`)
        .send({ amount: 20, reason: 'float top-up' });
      expect(cashIn.status).toBe(200);
    });

    it('Test B — single handover: Brian can operate the shift, Alice (who handed it off) cannot', async () => {
      const till = await setupTill(100);
      const alice = await createTestUser({ role: 'CASHIER' });
      const brian = await createTestUser({ role: 'CASHIER' });
      const supervisor = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });

      const openRes = await request(app)
        .post('/api/shifts/open-for-till')
        .set('Authorization', `Bearer ${tokenFor(alice)}`)
        .send({ tillId: till.id, declaredOpeningCash: 100 });
      const shiftId = openRes.body.id;

      await request(app)
        .post(`/api/shifts/${shiftId}/handover`)
        .set('Authorization', `Bearer ${tokenFor(alice)}`)
        .send({ toUserId: brian.id, declaredTotal: 100 });

      // Alice: every cashier write action on this shift is now denied.
      for (const [path, body] of [
        ['cash-in', { amount: 10 }],
        ['cash-out', { amount: 10, reason: 'x' }],
        ['paid-out', { amount: 10, reason: 'x' }],
        ['safe-drop', { amount: 10, safeId: 'SAFE-1' }],
      ]) {
        const res = await request(app)
          .post(`/api/shifts/${shiftId}/${path}`)
          .set('Authorization', `Bearer ${tokenFor(alice)}`)
          .send(body);
        expect(res.status).toBe(403);
      }

      // Brian: every one of the same actions succeeds.
      const cashIn = await request(app)
        .post(`/api/shifts/${shiftId}/cash-in`)
        .set('Authorization', `Bearer ${tokenFor(brian)}`)
        .send({ amount: 10, reason: 'x' });
      expect(cashIn.status).toBe(200);

      const cashOut = await request(app)
        .post(`/api/shifts/${shiftId}/cash-out`)
        .set('Authorization', `Bearer ${tokenFor(brian)}`)
        .send({ amount: 5, reason: 'x' });
      expect(cashOut.status).toBe(200);

      const paidOut = await request(app)
        .post(`/api/shifts/${shiftId}/paid-out`)
        .set('Authorization', `Bearer ${tokenFor(brian)}`)
        .send({ amount: 5, reason: 'x' });
      expect(paidOut.status).toBe(200);

      const safeDrop = await request(app)
        .post(`/api/shifts/${shiftId}/safe-drop`)
        .set('Authorization', `Bearer ${tokenFor(brian)}`)
        .send({ amount: 5, safeId: 'SAFE-1' });
      expect(safeDrop.status).toBe(200);

      // Alice cannot end the shift; Brian can.
      const aliceEndAttempt = await mintShiftEndApproval({ requester: alice, approver: supervisor, shiftId });
      const aliceEnd = await request(app)
        .post(`/api/shifts/${shiftId}/end`)
        .set('Authorization', `Bearer ${tokenFor(alice)}`)
        .send({ approvalId: aliceEndAttempt });
      expect(aliceEnd.status).toBe(403);

      const brianEndApproval = await mintShiftEndApproval({ requester: brian, approver: supervisor, shiftId });
      const brianEnd = await request(app)
        .post(`/api/shifts/${shiftId}/end`)
        .set('Authorization', `Bearer ${tokenFor(brian)}`)
        .send({ approvalId: brianEndApproval });
      expect(brianEnd.status).toBe(200);

      // Alice cannot submit the closing declaration; Brian can.
      const aliceDeclare = await request(app)
        .post(`/api/shifts/${shiftId}/declaration`)
        .set('Authorization', `Bearer ${tokenFor(alice)}`)
        .send({ declaredTotal: 115 });
      expect(aliceDeclare.status).toBe(403);

      const brianDeclare = await request(app)
        .post(`/api/shifts/${shiftId}/declaration`)
        .set('Authorization', `Bearer ${tokenFor(brian)}`)
        .send({ declaredTotal: 115 });
      expect(brianDeclare.status).toBe(201);
    });

    it('Test C — multiple handovers (Alice -> Brian -> Carol): only Carol, the current cashier, can operate; Alice and Brian cannot', async () => {
      const till = await setupTill(100);
      const alice = await createTestUser({ role: 'CASHIER' });
      const brian = await createTestUser({ role: 'CASHIER' });
      const carol = await createTestUser({ role: 'CASHIER' });
      const supervisor = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });

      const openRes = await request(app)
        .post('/api/shifts/open-for-till')
        .set('Authorization', `Bearer ${tokenFor(alice)}`)
        .send({ tillId: till.id, declaredOpeningCash: 100 });
      const shiftId = openRes.body.id;

      await request(app)
        .post(`/api/shifts/${shiftId}/handover`)
        .set('Authorization', `Bearer ${tokenFor(alice)}`)
        .send({ toUserId: brian.id, declaredTotal: 100 });

      await request(app)
        .post(`/api/shifts/${shiftId}/handover`)
        .set('Authorization', `Bearer ${tokenFor(brian)}`)
        .send({ toUserId: carol.id, declaredTotal: 100 });

      // Neither Alice nor Brian — a previous cashier, not merely a
      // non-cashier — can still record a movement. This is the case that
      // proves the resolution is "current turn," not "any past cashier":
      // Brian WAS authorized a moment ago and no longer is.
      for (const stale of [alice, brian]) {
        const res = await request(app)
          .post(`/api/shifts/${shiftId}/cash-in`)
          .set('Authorization', `Bearer ${tokenFor(stale)}`)
          .send({ amount: 10 });
        expect(res.status).toBe(403);
      }

      const carolCashIn = await request(app)
        .post(`/api/shifts/${shiftId}/cash-in`)
        .set('Authorization', `Bearer ${tokenFor(carol)}`)
        .send({ amount: 10, reason: 'x' });
      expect(carolCashIn.status).toBe(200);

      // End-shift and declaration follow the same rule for the final holder.
      for (const stale of [alice, brian]) {
        const approvalId = await mintShiftEndApproval({ requester: stale, approver: supervisor, shiftId });
        const res = await request(app)
          .post(`/api/shifts/${shiftId}/end`)
          .set('Authorization', `Bearer ${tokenFor(stale)}`)
          .send({ approvalId });
        expect(res.status).toBe(403);
      }

      const carolEndApproval = await mintShiftEndApproval({ requester: carol, approver: supervisor, shiftId });
      const carolEnd = await request(app)
        .post(`/api/shifts/${shiftId}/end`)
        .set('Authorization', `Bearer ${tokenFor(carol)}`)
        .send({ approvalId: carolEndApproval });
      expect(carolEnd.status).toBe(200);

      const carolDeclare = await request(app)
        .post(`/api/shifts/${shiftId}/declaration`)
        .set('Authorization', `Bearer ${tokenFor(carol)}`)
        .send({ declaredTotal: 110 });
      expect(carolDeclare.status).toBe(201);

      // A cashier — even the one who just ended and declared for this shift
      // — never sees expected cash or variance.
      const carolCurrentBeforeEnd = await request(app)
        .get(`/api/shifts/${shiftId}`)
        .set('Authorization', `Bearer ${tokenFor(carol)}`);
      expect(carolCurrentBeforeEnd.body.expectedCash).toBeUndefined();
      expect(carolCurrentBeforeEnd.body.variance).toBeUndefined();
    });
  });

  // Corrective work: closeShift()'s SELF_RECONCILE_DENIED check used to
  // compare only against shift.userId, so a supervisor who took part in a
  // handover chain via ShiftCashier — without ever being the original
  // opener — could reconcile a shift they personally worked. It now checks
  // the complete ShiftCashier participation history (isShiftParticipant).
  describe('reconciliation segregation of duties covers the full handover participation history', () => {
    it('Test D — every participant in a handover chain is denied reconciliation, even with shifts:reconcile; an uninvolved supervisor is allowed', async () => {
      const till = await setupTill(100);
      // SUPERVISOR (not CASHIER) so each participant genuinely HOLDS
      // shifts:reconcile — proving the denial is the structural
      // SELF_RECONCILE_DENIED check, not merely a missing permission.
      const alice = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1111') });
      const brian = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('2222') });
      const carol = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('3333') });
      const outsider = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('4444') });

      const openRes = await request(app)
        .post('/api/shifts/open-for-till')
        .set('Authorization', `Bearer ${tokenFor(alice)}`)
        .send({ tillId: till.id, declaredOpeningCash: 100 });
      const shiftId = openRes.body.id;

      await request(app)
        .post(`/api/shifts/${shiftId}/handover`)
        .set('Authorization', `Bearer ${tokenFor(alice)}`)
        .send({ toUserId: brian.id, declaredTotal: 100 });
      await request(app)
        .post(`/api/shifts/${shiftId}/handover`)
        .set('Authorization', `Bearer ${tokenFor(brian)}`)
        .send({ toUserId: carol.id, declaredTotal: 100 });

      const approvalId = await mintShiftEndApproval({ requester: carol, approver: outsider, shiftId, pin: '4444' });
      const ended = await request(app)
        .post(`/api/shifts/${shiftId}/end`)
        .set('Authorization', `Bearer ${tokenFor(carol)}`)
        .send({ approvalId });
      expect(ended.status).toBe(200);

      await request(app)
        .post(`/api/shifts/${shiftId}/declaration`)
        .set('Authorization', `Bearer ${tokenFor(carol)}`)
        .send({ declaredTotal: 110 });

      for (const participant of [alice, brian, carol]) {
        const res = await request(app)
          .post(`/api/shifts/${shiftId}/close`)
          .set('Authorization', `Bearer ${tokenFor(participant)}`)
          .send({});
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('SELF_RECONCILE_DENIED');
      }

      const closed = await request(app)
        .post(`/api/shifts/${shiftId}/close`)
        .set('Authorization', `Bearer ${tokenFor(outsider)}`)
        .send({});
      expect(closed.status).toBe(200);
      expect(closed.body.status).toBe('CLOSED');
    });
  });
});
