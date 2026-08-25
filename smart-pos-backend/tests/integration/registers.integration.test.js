import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import registerRoutes from '../../routes/registers.js';

const { createTestBranch, createTestUser, createTestRegister, cleanupTestData, DEFAULT_BRANCH_CODE } = testData;
const { createTestApp } = testApp;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

describe('routes/registers — V1 register/till model CRUD', () => {
  const app = createTestApp('/api/registers', registerRoutes);

  afterEach(async () => {
    await cleanupTestData();
  });

  it('POST / is gated behind settings:write — a cashier (no settings:write) is forbidden', async () => {
    await createTestBranch();
    const cashier = await createTestUser({ role: 'CASHIER' });
    const res = await request(app)
      .post('/api/registers')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ code: 'TEST-REG-R1', name: 'Front', branchId: DEFAULT_BRANCH_CODE });
    expect(res.status).toBe(403);
  });

  it('an admin can create a register, then a till under it', async () => {
    await createTestBranch();
    const admin = await createTestUser({ role: 'ADMIN' });

    const regRes = await request(app)
      .post('/api/registers')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ code: 'TEST-REG-R2', name: 'Front Counter', branchId: DEFAULT_BRANCH_CODE });
    expect(regRes.status).toBe(201);
    expect(regRes.body.isActive).toBe(true);

    const tillRes = await request(app)
      .post('/api/registers/tills')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ code: 'TEST-TILL-R2', name: 'Drawer 1', registerId: regRes.body.id, defaultOpeningFloat: 300 });
    expect(tillRes.status).toBe(201);
    expect(tillRes.body.defaultOpeningFloat).toBe(300);

    const listRes = await request(app)
      .get(`/api/registers/tills?registerId=${regRes.body.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.map((t) => t.id)).toContain(tillRes.body.id);
  });

  it('GET / is gated behind settings:read too — a manager (no settings:read by default) is forbidden', async () => {
    await createTestBranch();
    const manager = await createTestUser({ role: 'MANAGER' });
    const listRes = await request(app)
      .get('/api/registers')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);
    expect(listRes.status).toBe(403);
  });

  it('PATCH /:id can deactivate a register without deleting it', async () => {
    await createTestBranch();
    const admin = await createTestUser({ role: 'ADMIN' });
    const reg = await createTestRegister({ branchId: DEFAULT_BRANCH_CODE });

    const res = await request(app)
      .patch(`/api/registers/${reg.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });
});
