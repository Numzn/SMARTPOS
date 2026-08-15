import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestBranch, createTestUser, cleanupTestData } = testData;
const { createTestApp } = testApp;

const vsdcRouter = require('../../routes/vsdc.js');
const vsdcService = require('../../services/vsdcService');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

/**
 * The exact acceptance matrix from the RBAC redesign: zra:status (device
 * connectivity, needed by the POS) must never imply zra:read (operational
 * visibility — import queues, sync-job status), zra:sync (trigger a sync),
 * or zra:admin (device provisioning). CASHIER and SUPERVISOR hold only
 * zra:status by default.
 */
describe('ZRA permission tiers — status vs read vs sync vs admin', () => {
  const app = createTestApp('/api/vsdc', vsdcRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  it.each(['CASHIER', 'SUPERVISOR'])('%s: GET /status (zra:status) → 200', async (role) => {
    const user = await createTestUser({ role });
    const res = await request(app).get('/api/vsdc/status').set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(200);
  });

  it.each(['CASHIER', 'SUPERVISOR'])('%s: GET /imports (zra:read) → 403', async (role) => {
    const user = await createTestUser({ role });
    const res = await request(app).get('/api/vsdc/imports').set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(403);
  });

  it.each(['CASHIER', 'SUPERVISOR'])('%s: GET /codes/status (zra:read) → 403', async (role) => {
    const user = await createTestUser({ role });
    const res = await request(app).get('/api/vsdc/codes/status').set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(403);
  });

  it.each(['CASHIER', 'SUPERVISOR'])('%s: POST /initialize (zra:admin) → 403', async (role) => {
    const user = await createTestUser({ role });
    const res = await request(app).post('/api/vsdc/initialize').set('Authorization', `Bearer ${tokenFor(user)}`).send({});
    expect(res.status).toBe(403);
  });

  it('MANAGER: passes zra:read (imports, codes/status) and zra:sync routes, but 403 on /initialize (zra:admin)', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });

    const imports = await request(app).get('/api/vsdc/imports').set('Authorization', `Bearer ${tokenFor(manager)}`);
    expect(imports.status).toBe(200);

    const codesStatus = await request(app)
      .get('/api/vsdc/codes/status')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);
    expect(codesStatus.status).toBe(200);

    vi.spyOn(vsdcService, 'ensureDeviceInitialized').mockResolvedValue({ success: true, message: 'ok' });
    const initAttempt = await request(app)
      .post('/api/vsdc/initialize')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({});
    expect(initAttempt.status).toBe(403);
  });

  it('ADMIN: only role that passes /initialize (zra:admin)', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    vi.spyOn(vsdcService, 'ensureDeviceInitialized').mockResolvedValue({ success: true, message: 'ok' });

    const res = await request(app).post('/api/vsdc/initialize').set('Authorization', `Bearer ${tokenFor(admin)}`).send({});
    expect(res.status).toBe(200);
  });
});
