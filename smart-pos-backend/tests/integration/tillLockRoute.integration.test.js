import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import tillLockRouter from '../../routes/tillLock.js';
import tillApprovalsRouter from '../../routes/tillApprovals.js';

const { createTestBranch, createTestUser, createTestProduct, cleanupTestData, DEFAULT_BRANCH_CODE } = testData;
const { createTestApp } = testApp;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

// Route-level coverage for POS Control Phase 1 — the lib-level tests
// (tillLock.unit.test.js, approval.unit.test.js) cover the business rules in
// depth; this proves the HTTP wiring (permission gates, request/response
// shape) actually calls them.
describe('POST/GET/PATCH/DELETE /api/till/sessions, POST /api/till/approvals', () => {
  const app = createTestApp('/api/till', tillLockRouter);
  const approvalsApp = createTestApp('/api/till', tillApprovalsRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('POST /sessions is gated behind sales:write — a viewer is forbidden', async () => {
    const viewer = await createTestUser({ role: 'VIEWER' });
    const res = await request(app)
      .post('/api/till/sessions')
      .set('Authorization', `Bearer ${tokenFor(viewer)}`)
      .send({ branchId: DEFAULT_BRANCH_CODE });
    expect(res.status).toBe(403);
  });

  it('a cashier can open a session, scan an item, and read it back', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const product = await createTestProduct();

    const openRes = await request(app)
      .post('/api/till/sessions')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ branchId: DEFAULT_BRANCH_CODE });
    expect(openRes.status).toBe(201);
    const sessionId = openRes.body.session.id;

    const scanRes = await request(app)
      .post(`/api/till/sessions/${sessionId}/scan`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ productId: product.id, quantity: 2, unitPrice: 15 });
    expect(scanRes.status).toBe(201);
    expect(scanRes.body.line.quantity).toBe(2);

    const getRes = await request(app)
      .get(`/api/till/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.lines).toHaveLength(1);
  });

  it('a different cashier gets 403 trying to scan into someone else\'s session', async () => {
    const owner = await createTestUser({ role: 'CASHIER' });
    const intruder = await createTestUser({ role: 'CASHIER' });
    const product = await createTestProduct();

    const openRes = await request(app)
      .post('/api/till/sessions')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ branchId: DEFAULT_BRANCH_CODE });
    const sessionId = openRes.body.session.id;

    const scanRes = await request(app)
      .post(`/api/till/sessions/${sessionId}/scan`)
      .set('Authorization', `Bearer ${tokenFor(intruder)}`)
      .send({ productId: product.id, quantity: 1, unitPrice: 15 });
    expect(scanRes.status).toBe(403);
  });

  it('reversing a line end-to-end: request an approval ticket, then apply it via PATCH', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const supervisor = await createTestUser({ role: 'SUPERVISOR', pinHash: await bcrypt.hash('4321', 4) });
    const product = await createTestProduct();

    const openRes = await request(app)
      .post('/api/till/sessions')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ branchId: DEFAULT_BRANCH_CODE });
    const sessionId = openRes.body.session.id;

    await request(app)
      .post(`/api/till/sessions/${sessionId}/scan`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ productId: product.id, quantity: 4, unitPrice: 15 });

    const approvalRes = await request(approvalsApp)
      .post('/api/till/approvals')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({
        actionType: 'LINE_REVERSAL',
        method: 'PIN',
        credential: '4321',
        approverUserId: supervisor.id,
        sessionId,
        target: { productId: product.id, quantity: 1 },
      });
    expect(approvalRes.status).toBe(201);
    const { approvalId } = approvalRes.body;

    const patchRes = await request(app)
      .patch(`/api/till/sessions/${sessionId}/lines/${product.id}`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ toQuantity: 3, approvalId, reasonCode: 'CUSTOMER_CHANGED_MIND' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.line.quantity).toBe(3);
  });

  it('a reversal PATCH without a valid approvalId is rejected', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const product = await createTestProduct();

    const openRes = await request(app)
      .post('/api/till/sessions')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ branchId: DEFAULT_BRANCH_CODE });
    const sessionId = openRes.body.session.id;

    await request(app)
      .post(`/api/till/sessions/${sessionId}/scan`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ productId: product.id, quantity: 4, unitPrice: 15 });

    const patchRes = await request(app)
      .patch(`/api/till/sessions/${sessionId}/lines/${product.id}`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ toQuantity: 3, reasonCode: 'CUSTOMER_CHANGED_MIND' });

    expect(patchRes.status).toBe(403);
  });

  it('DELETE /sessions/:id abandons the session — no approval required', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });

    const openRes = await request(app)
      .post('/api/till/sessions')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ branchId: DEFAULT_BRANCH_CODE });
    const sessionId = openRes.body.session.id;

    const delRes = await request(app)
      .delete(`/api/till/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.session.status).toBe('ABANDONED');
  });

  it('POST /approvals rejects a cashier-as-approver with 403', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const otherCashier = await createTestUser({ role: 'CASHIER', pinHash: await bcrypt.hash('1111', 4) });

    const openRes = await request(app)
      .post('/api/till/sessions')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ branchId: DEFAULT_BRANCH_CODE });
    const sessionId = openRes.body.session.id;

    const res = await request(approvalsApp)
      .post('/api/till/approvals')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({
        actionType: 'LINE_REVERSAL',
        method: 'PIN',
        credential: '1111',
        approverUserId: otherCashier.id,
        sessionId,
        target: { productId: 'irrelevant', quantity: 1 },
      });

    expect(res.status).toBe(403);
  });

  it('GET /approvers lists active SUPERVISOR/MANAGER/ADMIN by name only, excludes cashiers', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const supervisor = await createTestUser({ role: 'SUPERVISOR', name: 'Test Supervisor' });
    const inactiveManager = await createTestUser({ role: 'MANAGER', name: 'Inactive Manager', isActive: false });
    await createTestUser({ role: 'CASHIER', name: 'Another Cashier' });

    const res = await request(approvalsApp)
      .get('/api/till/approvers')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);

    expect(res.status).toBe(200);
    const ids = res.body.approvers.map((a) => a.id);
    expect(ids).toContain(supervisor.id);
    expect(ids).not.toContain(cashier.id);
    expect(ids).not.toContain(inactiveManager.id);
    expect(res.body.approvers[0]).not.toHaveProperty('email');
  });

  it('POST /approvals rejects self-approval at the HTTP layer (requesterUserId threaded from the authenticated caller)', async () => {
    const supervisor = await createTestUser({ role: 'SUPERVISOR', pinHash: await bcrypt.hash('4321', 4) });

    const openRes = await request(app)
      .post('/api/till/sessions')
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`)
      .send({ branchId: DEFAULT_BRANCH_CODE });
    const sessionId = openRes.body.session.id;

    const res = await request(approvalsApp)
      .post('/api/till/approvals')
      .set('Authorization', `Bearer ${tokenFor(supervisor)}`)
      .send({
        actionType: 'LINE_REVERSAL',
        method: 'PIN',
        credential: '4321',
        approverUserId: supervisor.id, // approving their own request
        sessionId,
        target: { productId: 'irrelevant', quantity: 1 },
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SELF_APPROVAL_DENIED');
  });
});
