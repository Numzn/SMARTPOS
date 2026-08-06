import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import usersRouter from '../../routes/users.js';

const { createTestBranch, createTestUser, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

describe('User admin lifecycle routes', () => {
  const app = createTestApp('/api/users', usersRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('fixed routes like /profile are not shadowed by the /:id wildcard mounted after them', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const res = await request(app).get('/api/users/profile').set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(admin.id);
  });

  it('admin can deactivate another user, who is then blocked from authenticated routes', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const cashier = await createTestUser({ role: 'CASHIER' });

    const putRes = await request(app)
      .put(`/api/users/${cashier.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ isActive: false });
    expect(putRes.status).toBe(200);
    expect(putRes.body.user.isActive).toBe(false);

    const blockedRes = await request(app)
      .get('/api/users/profile')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(blockedRes.status).toBe(403);
    expect(blockedRes.body.code).toBe('USER_INACTIVE');
  });

  it('admin can reactivate a previously deactivated user', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const cashier = await createTestUser({ role: 'CASHIER', isActive: false });

    const res = await request(app)
      .put(`/api/users/${cashier.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ isActive: true });
    expect(res.status).toBe(200);
    expect(res.body.user.isActive).toBe(true);
  });

  it('admin cannot deactivate their own account', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const res = await request(app)
      .put(`/api/users/${admin.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ isActive: false });
    expect(res.status).toBe(400);
  });

  it('a non-admin cannot update another user (role-gated)', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const otherUser = await createTestUser();
    const res = await request(app)
      .put(`/api/users/${otherUser.id}`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ role: 'ADMIN' });
    expect(res.status).toBe(403);
  });

  it('admin can change a user role and rejects an invalid one', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const cashier = await createTestUser({ role: 'CASHIER' });

    const ok = await request(app)
      .put(`/api/users/${cashier.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ role: 'MANAGER' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe('MANAGER');

    const bad = await request(app)
      .put(`/api/users/${cashier.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ role: 'SUPERUSER' });
    expect(bad.status).toBe(400);
  });

  it('admin reset-password generates a working temporary password when none supplied', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const target = await createTestUser({ password: await bcrypt.hash('original-password', 4) });

    const res = await request(app)
      .post(`/api/users/${target.id}/reset-password`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(typeof res.body.temporaryPassword).toBe('string');
    expect(res.body.temporaryPassword.length).toBeGreaterThan(8);

    const updated = await prisma.user.findUnique({ where: { id: target.id } });
    expect(await bcrypt.compare(res.body.temporaryPassword, updated.password)).toBe(true);
  });

  it('admin reset-password accepts a supplied password and never echoes it back', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const target = await createTestUser();

    const res = await request(app)
      .post(`/api/users/${target.id}/reset-password`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ newPassword: 'admin-supplied-password' });

    expect(res.status).toBe(200);
    expect(res.body.temporaryPassword).toBeUndefined();

    const updated = await prisma.user.findUnique({ where: { id: target.id } });
    expect(await bcrypt.compare('admin-supplied-password', updated.password)).toBe(true);
  });

  it('rejects registration with a too-short password', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const res = await request(app)
      .post('/api/users/register')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ email: 'short-pw@smartpos.test', name: 'Short PW', password: '123' });
    expect(res.status).toBe(400);

    await prisma.user.deleteMany({ where: { email: 'short-pw@smartpos.test' } });
  });
});
