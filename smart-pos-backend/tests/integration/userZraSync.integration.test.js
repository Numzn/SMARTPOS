import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestBranch, createTestUser, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

const vsdcGateway = require('../../lib/vsdc-gateway');
vsdcGateway.saveBranchUser = vi.fn();

const usersRouter = require('../../routes/users.js');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

describe('POST /api/users/:id/zra-sync', () => {
  const app = createTestApp('/api/users', usersRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    vsdcGateway.saveBranchUser.mockReset();
    await cleanupTestData();
  });

  it('REGRESSION: rejects a user with no assigned branch before calling VSDC', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const staff = await createTestUser({ branchId: null });

    const res = await request(app)
      .post(`/api/users/${staff.id}/zra-sync`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no assigned branch/);
    expect(vsdcGateway.saveBranchUser).not.toHaveBeenCalled();
  });

  it('REGRESSION: syncs a user with a branch and returns the updated record', async () => {
    vsdcGateway.saveBranchUser.mockImplementation(async (user) => {
      await prisma.user.update({ where: { id: user.id }, data: { zraSyncedAt: new Date() } });
      return { success: true };
    });
    const admin = await createTestUser({ role: 'ADMIN' });
    const staff = await createTestUser();

    const res = await request(app)
      .post(`/api/users/${staff.id}/zra-sync`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.user.zraSyncedAt).toBeTruthy();
  });

  it('REGRESSION: surfaces a ZRA rejection as 422', async () => {
    vsdcGateway.saveBranchUser.mockRejectedValue(new Error('ZRA rejected: duplicate user'));
    const admin = await createTestUser({ role: 'ADMIN' });
    const staff = await createTestUser();

    const res = await request(app)
      .post(`/api/users/${staff.id}/zra-sync`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/duplicate user/);
  });

  it('REGRESSION: is gated behind ADMIN role — a manager is forbidden', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const staff = await createTestUser();

    const res = await request(app)
      .post(`/api/users/${staff.id}/zra-sync`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(403);
    expect(vsdcGateway.saveBranchUser).not.toHaveBeenCalled();
  });
});
