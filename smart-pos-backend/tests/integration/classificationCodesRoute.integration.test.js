import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestBranch, createTestUser, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

const itemManagementService = require('../../services/itemManagement.js');
const zraCodesService = require('../../services/zraCodesService.js');
const itemsRouter = require('../../routes/items.js');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

describe('GET /api/items/classification-codes', () => {
  const app = createTestApp('/api/items', itemsRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.zraClassificationCode.deleteMany({ where: { code: { startsWith: 'ROUTE-TEST-' } } });
    await cleanupTestData();
  });

  it('REGRESSION: reads from the synced ZraClassificationCode table via zraCodesService, not the hardcoded mock-only path', async () => {
    const getItemClassificationsSpy = vi.spyOn(zraCodesService, 'getItemClassifications');
    // The bug this fixes: routes/items.js used to call this method instead,
    // which posted to a hardcoded /api/codes/get path bypassing endpointAdapter.
    const brokenMethodSpy = vi.spyOn(itemManagementService, 'getItemClassificationCodes');

    await prisma.zraClassificationCode.upsert({
      where: { code: 'ROUTE-TEST-1' },
      create: { code: 'ROUTE-TEST-1', name: 'Route Test Category', useYn: 'Y' },
      update: { useYn: 'Y' },
    });

    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .get('/api/items/classification-codes')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.codes.some((c) => c.code === 'ROUTE-TEST-1')).toBe(true);
    expect(getItemClassificationsSpy).toHaveBeenCalled();
    expect(brokenMethodSpy).not.toHaveBeenCalled();
  });

  it('REGRESSION: does not serve a code explicitly marked useYn=N', async () => {
    await prisma.zraClassificationCode.upsert({
      where: { code: 'ROUTE-TEST-DEPRECATED' },
      create: { code: 'ROUTE-TEST-DEPRECATED', name: 'Deprecated', useYn: 'N' },
      update: { useYn: 'N' },
    });

    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .get('/api/items/classification-codes')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.codes.some((c) => c.code === 'ROUTE-TEST-DEPRECATED')).toBe(false);
  });

  it('REGRESSION: is gated behind products:read', async () => {
    const res = await request(app).get('/api/items/classification-codes');
    expect(res.status).toBe(401);
  });
});
