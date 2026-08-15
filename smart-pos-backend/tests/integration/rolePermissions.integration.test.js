import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import settingsRouter from '../../routes/settings.js';
import shiftsRouter from '../../routes/shifts.js';
import { setRolePermission } from '../../lib/permissions.js';

const { createTestBranch, createTestUser, cleanupTestData } = testData;
const { createTestApp } = testApp;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

describe('Configurable RBAC — PUT /api/settings/roles/:role', () => {
  const settingsApp = createTestApp('/api/settings', settingsRouter);
  const shiftsApp = createTestApp('/api/shifts', shiftsRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
    // Always leave CASHIER's shifts:operate grant restored, even if a test
    // fails mid-way, so it can't poison a later test file's assumptions.
    await setRolePermission('CASHIER', 'shifts:operate', true, null);
  });

  it('requires ADMIN — a MANAGER holding settings:write is still forbidden', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const res = await request(settingsApp)
      .put('/api/settings/roles/CASHIER')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ permission: 'shifts:operate', granted: false });
    expect(res.status).toBe(403);
  });

  it('rejects an unrecognized permission string', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const res = await request(settingsApp)
      .put('/api/settings/roles/CASHIER')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ permission: 'not:a-real-permission', granted: true });
    expect(res.status).toBe(400);
  });

  it('rejects an unrecognized role', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const res = await request(settingsApp)
      .put('/api/settings/roles/NOT_A_ROLE')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ permission: 'sales:read', granted: true });
    expect(res.status).toBe(400);
  });

  it('GET /api/settings/roles lists the full matrix, ADMIN-only', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const cashier = await createTestUser({ role: 'CASHIER' });

    const denied = await request(settingsApp)
      .get('/api/settings/roles')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(denied.status).toBe(403);

    const res = await request(settingsApp)
      .get('/api/settings/roles')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.roles).toContain('CASHIER');
    expect(res.body.permissions).toContain('shifts:reconcile');
    expect(Array.isArray(res.body.grants)).toBe(true);
  });

  /**
   * The mandatory configuration test: an ADMIN removes a permission from a
   * role, the very next request from that role is denied, then restoring
   * the permission makes the very next request succeed again — all without
   * any code change or process restart. This is the deliverable's explicit
   * proof that the RBAC redesign is actually configurable.
   */
  it('CONFIGURATION TEST: revoking then restoring a permission changes live behavior with no code change', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const cashier = await createTestUser({ role: 'CASHIER' });

    // 1. Baseline: cashier can open a shift (shifts:operate granted by default).
    const before = await request(shiftsApp)
      .post('/api/shifts/open')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ openingFloat: 0 });
    expect(before.status).toBe(201);

    // Close it so the next open isn't blocked by the "already has an open shift" rule.
    const reconciler = await createTestUser({ role: 'SUPERVISOR' });
    await request(shiftsApp)
      .post(`/api/shifts/${before.body.id}/close`)
      .set('Authorization', `Bearer ${tokenFor(reconciler)}`)
      .send({ countedCash: 0 });

    // 2. ADMIN revokes shifts:operate from CASHIER via the API.
    const revoke = await request(settingsApp)
      .put('/api/settings/roles/CASHIER')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ permission: 'shifts:operate', granted: false });
    expect(revoke.status).toBe(200);

    // 3. The very next request from a CASHIER token is denied — no re-login,
    // no restart, no source change.
    const denied = await request(shiftsApp)
      .post('/api/shifts/open')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ openingFloat: 0 });
    expect(denied.status).toBe(403);

    // 4. ADMIN restores the permission.
    const restore = await request(settingsApp)
      .put('/api/settings/roles/CASHIER')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ permission: 'shifts:operate', granted: true });
    expect(restore.status).toBe(200);

    // 5. Behavior is restored on the next request.
    const allowedAgain = await request(shiftsApp)
      .post('/api/shifts/open')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ openingFloat: 0 });
    expect(allowedAgain.status).toBe(201);
  });

  it('ADMIN has no code-level bypass — revoking an ADMIN permission via the real admin API actually denies ADMIN', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const secondAdmin = await createTestUser({ role: 'ADMIN' }); // does the revoking, so the revoke request itself isn't blocked by anything odd about `admin`

    // Exercise the same HTTP path a real ADMIN would use (routes/settings.js),
    // not the lib function directly — this is what actually proves ADMIN's
    // access is governed by the same RolePermission table as every other
    // role, with no separate code-level bypass anywhere in the stack.
    const revoke = await request(settingsApp)
      .put('/api/settings/roles/ADMIN')
      .set('Authorization', `Bearer ${tokenFor(secondAdmin)}`)
      .send({ permission: 'shifts:reopen', granted: false });
    expect(revoke.status).toBe(200);

    try {
      const shift = await request(shiftsApp)
        .post('/api/shifts/open')
        .set('Authorization', `Bearer ${tokenFor(admin)}`)
        .send({ openingFloat: 0 });
      const reconciler = await createTestUser({ role: 'MANAGER' });
      await request(shiftsApp)
        .post(`/api/shifts/${shift.body.id}/close`)
        .set('Authorization', `Bearer ${tokenFor(reconciler)}`)
        .send({ countedCash: 0 });

      const reopen = await request(shiftsApp)
        .post(`/api/shifts/${shift.body.id}/reopen`)
        .set('Authorization', `Bearer ${tokenFor(admin)}`)
        .send({});
      expect(reopen.status).toBe(403);
    } finally {
      await request(settingsApp)
        .put('/api/settings/roles/ADMIN')
        .set('Authorization', `Bearer ${tokenFor(secondAdmin)}`)
        .send({ permission: 'shifts:reopen', granted: true });
    }
  });
});
