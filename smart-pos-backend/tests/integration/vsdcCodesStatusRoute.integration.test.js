import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestBranch, createTestUser, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

const vsdcRouter = require('../../routes/vsdc.js');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

const TEST_CLASS_A = 'TEST_CODES_STATUS_A';
const TEST_CLASS_B = 'TEST_CODES_STATUS_B';

// Item 2* UI gap fix — read-only "last synced" summary consumed by the new
// ZRA Sync admin page. No cursor model exists for codes sync (it's
// upsert-all-on-demand, not incremental), so this aggregates directly off
// ZraCode.syncedAt rather than a dedicated status table.
describe('GET /api/vsdc/codes/status', () => {
  const app = createTestApp('/api/vsdc', vsdcRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await prisma.zraCode.deleteMany({ where: { codeClass: { in: [TEST_CLASS_A, TEST_CLASS_B] } } });
    await cleanupTestData();
  });

  it('is gated behind authentication — unauthenticated request rejected', async () => {
    const res = await request(app).get('/api/vsdc/codes/status');
    expect(res.status).toBe(401);
  });

  it('is reachable by a CASHIER — zra:read is broadly granted, unlike the zra:sync-gated POST routes', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });

    const res = await request(app)
      .get('/api/vsdc/codes/status')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);

    expect(res.status).toBe(200);
  });

  it('response shape: everSynced/standard/classification counts are well-typed', async () => {
    // ZraCode is a shared global table other test files write to without
    // cleanup (unlike TEST-SKU-prefixed rows, it has no test-scoping
    // convention) — this suite runs serially against a shared DB
    // (vitest.config.js's fileParallelism:false), so an "empty table"
    // assumption here would be flaky depending on run order. Assert types
    // and invariants instead of absolute counts.
    const user = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .get('/api/vsdc/codes/status')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.everSynced).toBe('boolean');
    expect(typeof res.body.standard.count).toBe('number');
    expect(Array.isArray(res.body.standard.byClass)).toBe(true);
    expect(typeof res.body.classification.count).toBe('number');
    // everSynced is exactly "was anything ever synced" — true whenever a
    // lastSyncedAt exists on either side.
    expect(res.body.everSynced).toBe(
      Boolean(res.body.standard.lastSyncedAt || res.body.classification.lastSyncedAt)
    );
  });

  it('reports correct counts and per-class breakdown after codes exist', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    const before = await request(app)
      .get('/api/vsdc/codes/status')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    const countBefore = before.body.standard.count;

    await prisma.zraCode.create({
      data: { codeClass: TEST_CLASS_A, code: 'A1', name: 'Test Code A1', syncedAt: new Date('2026-01-01T00:00:00Z') },
    });
    await prisma.zraCode.create({
      data: { codeClass: TEST_CLASS_A, code: 'A2', name: 'Test Code A2', syncedAt: new Date('2026-01-02T00:00:00Z') },
    });
    await prisma.zraCode.create({
      data: { codeClass: TEST_CLASS_B, code: 'B1', name: 'Test Code B1', syncedAt: new Date('2026-01-03T00:00:00Z') },
    });

    const res = await request(app)
      .get('/api/vsdc/codes/status')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.everSynced).toBe(true);
    // Exactly 3 more than before this test's own inserts — proves the
    // aggregate reflects real rows, without assuming the table was empty.
    expect(res.body.standard.count).toBe(countBefore + 3);

    const classA = res.body.standard.byClass.find((g) => g.codeClass === TEST_CLASS_A);
    const classB = res.body.standard.byClass.find((g) => g.codeClass === TEST_CLASS_B);
    expect(classA.count).toBe(2);
    expect(new Date(classA.lastSyncedAt).toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(classB.count).toBe(1);
    expect(new Date(classB.lastSyncedAt).toISOString()).toBe('2026-01-03T00:00:00.000Z');
  });
});
