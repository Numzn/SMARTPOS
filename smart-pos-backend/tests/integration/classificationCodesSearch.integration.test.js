import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestBranch, createTestUser, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

const itemsRouter = require('../../routes/items.js');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

// The ?q=&limit= search path added for ClassificationPicker.jsx's type-ahead
// (Section 5 UI layer). The no-query-param path is covered by the existing
// REGRESSION suite in classificationCodesRoute.integration.test.js and is
// deliberately left untouched here.
describe('GET /api/items/classification-codes?q=&limit= (search)', () => {
  const app = createTestApp('/api/items', itemsRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await prisma.zraClassificationCode.deleteMany({ where: { code: { startsWith: 'ROUTE-SEARCH-' } } });
    await cleanupTestData();
  });

  it('filters results by the q parameter', async () => {
    await prisma.zraClassificationCode.upsert({
      where: { code: 'ROUTE-SEARCH-CEMENT' },
      create: { code: 'ROUTE-SEARCH-CEMENT', name: 'Portland cement', useYn: 'Y' },
      update: { useYn: 'Y' },
    });
    await prisma.zraClassificationCode.upsert({
      where: { code: 'ROUTE-SEARCH-OTHER' },
      create: { code: 'ROUTE-SEARCH-OTHER', name: 'Completely unrelated', useYn: 'Y' },
      update: { useYn: 'Y' },
    });

    const user = await createTestUser({ role: 'MANAGER' });
    const res = await request(app)
      .get('/api/items/classification-codes?q=cement')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    const codes = res.body.codes.map((c) => c.code);
    expect(codes).toContain('ROUTE-SEARCH-CEMENT');
    expect(codes).not.toContain('ROUTE-SEARCH-OTHER');
  });

  it('bounds the result count via limit', async () => {
    for (let i = 0; i < 10; i += 1) {
      await prisma.zraClassificationCode.upsert({
        where: { code: `ROUTE-SEARCH-LIMIT-${i}` },
        create: { code: `ROUTE-SEARCH-LIMIT-${i}`, name: 'Limit test row', useYn: 'Y' },
        update: { useYn: 'Y' },
      });
    }

    const user = await createTestUser({ role: 'MANAGER' });
    const res = await request(app)
      .get('/api/items/classification-codes?q=Limit test row&limit=3')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.codes.length).toBeLessThanOrEqual(3);
  });

  it('never returns a code marked useYn=N, even when it matches the search term', async () => {
    await prisma.zraClassificationCode.upsert({
      where: { code: 'ROUTE-SEARCH-DEPRECATED' },
      create: { code: 'ROUTE-SEARCH-DEPRECATED', name: 'Deprecated search hit', useYn: 'N' },
      update: { useYn: 'N' },
    });

    const user = await createTestUser({ role: 'MANAGER' });
    const res = await request(app)
      .get('/api/items/classification-codes?q=Deprecated search hit')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.codes.some((c) => c.code === 'ROUTE-SEARCH-DEPRECATED')).toBe(false);
  });

  it('returns an empty (not error) result for a term with no matches', async () => {
    const user = await createTestUser({ role: 'MANAGER' });
    const res = await request(app)
      .get('/api/items/classification-codes?q=NO-SUCH-TERM-ANYWHERE-XYZ')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.codes).toEqual([]);
  });

  it('is gated behind products:read, same as the unfiltered path', async () => {
    const res = await request(app).get('/api/items/classification-codes?q=anything');
    expect(res.status).toBe(401);
  });
});
