import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestUser, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

const auditRouter = require('../../routes/audit.js');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

// routes/audit.js — first coverage for this route (previously untested).
// Seeds AuditLog rows directly via prisma rather than through
// auditService.safeLog, which is fire-and-forget (Promise.resolve().then,
// never awaited by its callers) and would make assertions here flaky; this
// route's own filtering/pagination logic doesn't depend on how a row got
// written, so a direct, deterministic seed is the right boundary to test at.
describe('GET /api/audit', () => {
  const app = createTestApp('/api/audit', auditRouter);
  const DESC_PREFIX = 'TEST-AUDIT-';

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { description: { startsWith: DESC_PREFIX } } });
    await cleanupTestData();
  });

  let seq = 0;
  async function seedRow(overrides = {}) {
    seq += 1;
    return prisma.auditLog.create({
      data: {
        id: `test-audit-${Date.now()}-${seq}`,
        eventType: 'PRODUCT_UPDATE',
        timestamp: new Date(),
        userId: null,
        userRole: null,
        entityType: null,
        entityId: null,
        action: null,
        description: `${DESC_PREFIX}row ${seq}`,
        riskLevel: 'LOW',
        success: true,
        hash: 'test-hash',
        ...overrides,
      },
    });
  }

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/audit');
    expect(res.status).toBe(401);
  });

  it.each(['CASHIER', 'SUPERVISOR'])('is forbidden for %s (no audit:read permission)', async (role) => {
    const user = await createTestUser({ role });
    const res = await request(app).get('/api/audit').set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(403);
  });

  it.each(['ADMIN', 'MANAGER'])('is accessible for %s', async (role) => {
    const user = await createTestUser({ role });
    const res = await request(app).get('/api/audit').set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('auditTrail');
    expect(res.body).toHaveProperty('totalCount');
  });

  it('filters by eventType', async () => {
    await seedRow({ eventType: 'PRODUCT_UPDATE' });
    await seedRow({ eventType: 'USER_LOGIN' });
    const admin = await createTestUser({ role: 'ADMIN' });

    const res = await request(app)
      .get('/api/audit')
      .query({ eventType: 'USER_LOGIN', limit: 1000 })
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    const rows = res.body.auditTrail.filter((r) => r.description?.startsWith(DESC_PREFIX));
    expect(rows.every((r) => r.eventType === 'USER_LOGIN')).toBe(true);
    expect(rows.length).toBe(1);
  });

  it('filters by userId', async () => {
    const targetUserId = 'test-audit-user-123';
    await seedRow({ userId: targetUserId });
    await seedRow({ userId: 'someone-else' });
    const admin = await createTestUser({ role: 'ADMIN' });

    const res = await request(app)
      .get('/api/audit')
      .query({ userId: targetUserId, limit: 1000 })
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    const rows = res.body.auditTrail.filter((r) => r.description?.startsWith(DESC_PREFIX));
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(targetUserId);
  });

  it('filters by entityType and entityId together', async () => {
    await seedRow({ entityType: 'PRODUCT', entityId: 'prod-1' });
    await seedRow({ entityType: 'PRODUCT', entityId: 'prod-2' });
    await seedRow({ entityType: 'USER', entityId: 'prod-1' });
    const admin = await createTestUser({ role: 'ADMIN' });

    const res = await request(app)
      .get('/api/audit')
      .query({ entityType: 'PRODUCT', entityId: 'prod-1', limit: 1000 })
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    const rows = res.body.auditTrail.filter((r) => r.description?.startsWith(DESC_PREFIX));
    expect(rows.length).toBe(1);
    expect(rows[0].entityType).toBe('PRODUCT');
    expect(rows[0].entityId).toBe('prod-1');
  });

  it('filters by riskLevel', async () => {
    await seedRow({ riskLevel: 'HIGH' });
    await seedRow({ riskLevel: 'LOW' });
    const admin = await createTestUser({ role: 'ADMIN' });

    const res = await request(app)
      .get('/api/audit')
      .query({ riskLevel: 'HIGH', limit: 1000 })
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    const rows = res.body.auditTrail.filter((r) => r.description?.startsWith(DESC_PREFIX));
    expect(rows.length).toBe(1);
    expect(rows[0].riskLevel).toBe('HIGH');
  });

  it('filters by success', async () => {
    await seedRow({ success: true });
    await seedRow({ success: false, errorMessage: 'boom' });
    const admin = await createTestUser({ role: 'ADMIN' });

    const res = await request(app)
      .get('/api/audit')
      .query({ success: 'false', limit: 1000 })
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    const rows = res.body.auditTrail.filter((r) => r.description?.startsWith(DESC_PREFIX));
    expect(rows.length).toBe(1);
    expect(rows[0].success).toBe(false);
  });

  it('filters by startDate/endDate', async () => {
    const old = new Date('2020-01-01T00:00:00Z');
    const recent = new Date();
    await seedRow({ timestamp: old });
    await seedRow({ timestamp: recent });
    const admin = await createTestUser({ role: 'ADMIN' });

    const res = await request(app)
      .get('/api/audit')
      .query({ startDate: '2024-01-01', limit: 1000 })
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    const rows = res.body.auditTrail.filter((r) => r.description?.startsWith(DESC_PREFIX));
    expect(rows.length).toBe(1);
  });

  it('paginates correctly and reports an accurate totalCount', async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await seedRow({ eventType: 'PAGINATION_TEST', timestamp: new Date(Date.now() + i * 1000) });
    }
    const admin = await createTestUser({ role: 'ADMIN' });

    const page1 = await request(app)
      .get('/api/audit')
      .query({ eventType: 'PAGINATION_TEST', limit: 2, offset: 0 })
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    const page2 = await request(app)
      .get('/api/audit')
      .query({ eventType: 'PAGINATION_TEST', limit: 2, offset: 2 })
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(page1.body.totalCount).toBe(5);
    expect(page1.body.auditTrail).toHaveLength(2);
    expect(page2.body.auditTrail).toHaveLength(2);
    const page1Ids = page1.body.auditTrail.map((r) => r.id);
    const page2Ids = page2.body.auditTrail.map((r) => r.id);
    expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
  });

  it('orders results newest-first', async () => {
    const earlier = await seedRow({ eventType: 'ORDER_TEST', timestamp: new Date(Date.now() - 5000) });
    const later = await seedRow({ eventType: 'ORDER_TEST', timestamp: new Date() });
    const admin = await createTestUser({ role: 'ADMIN' });

    const res = await request(app)
      .get('/api/audit')
      .query({ eventType: 'ORDER_TEST', limit: 1000 })
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    const ids = res.body.auditTrail.filter((r) => r.description?.startsWith(DESC_PREFIX)).map((r) => r.id);
    expect(ids).toEqual([later.id, earlier.id]);
  });
});
