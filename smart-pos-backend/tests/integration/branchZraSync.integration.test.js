import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestBranch, createTestUser, cleanupTestData } = testData;
const { createTestApp } = testApp;

const vsdcGateway = require('../../lib/vsdc-gateway');
vsdcGateway.ensureReady = vi.fn().mockResolvedValue({ success: true });
vsdcGateway.selectBranches = vi.fn();

const vsdcRouter = require('../../routes/vsdc.js');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

describe('POST /api/vsdc/branches/sync', () => {
  const app = createTestApp('/api/vsdc', vsdcRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    vsdcGateway.selectBranches.mockReset();
    vsdcGateway.ensureReady.mockClear();
    await cleanupTestData();
  });

  it('REGRESSION: pulls branches and returns the sync result', async () => {
    vsdcGateway.selectBranches.mockResolvedValue({ count: 1, matched: 1, path: '/branches/selectBranches' });
    const admin = await createTestUser({ role: 'ADMIN' });

    const res = await request(app)
      .post('/api/vsdc/branches/sync')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.matched).toBe(1);
    expect(vsdcGateway.selectBranches).toHaveBeenCalled();
  });

  it('REGRESSION: returns 503 rather than a false success when VSDC is not ready', async () => {
    vsdcGateway.ensureReady.mockResolvedValueOnce({ success: false, error: 'VSDC device not initialized' });
    const admin = await createTestUser({ role: 'ADMIN' });

    const res = await request(app)
      .post('/api/vsdc/branches/sync')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(503);
    expect(vsdcGateway.selectBranches).not.toHaveBeenCalled();
  });

  it('REGRESSION: is gated behind zra:sync — a cashier is forbidden', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });

    const res = await request(app)
      .post('/api/vsdc/branches/sync')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);

    expect(res.status).toBe(403);
    expect(vsdcGateway.selectBranches).not.toHaveBeenCalled();
  });

  it('surfaces a sync failure as 500, not a silent success', async () => {
    vsdcGateway.selectBranches.mockRejectedValue(new Error('branches/selectBranches failed'));
    const admin = await createTestUser({ role: 'ADMIN' });

    const res = await request(app)
      .post('/api/vsdc/branches/sync')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(500);
  });
});
