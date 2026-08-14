import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import settingsRouter from '../../routes/settings.js';
import { ensureDefaultBusinessProfile } from '../../lib/ensureBusinessProfile.js';
import { getDiscountPolicy, DEFAULT_DISCOUNT_POLICY } from '../../lib/discountPolicy.js';

const { createTestUser, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

// PATCH /api/settings/business's new discountPolicy handling — the smallest
// clean extension of the existing BusinessProfile settings write path
// (routes/settings.js), server-side validated. Not a ZRA requirement.
describe('PATCH /api/settings/business — discountPolicy', () => {
  const app = createTestApp('/api/settings', settingsRouter);

  beforeAll(async () => {
    await ensureDefaultBusinessProfile();
  });

  afterEach(async () => {
    await cleanupTestData();
    await prisma.businessProfile.update({ where: { id: 'default' }, data: { discountPolicy: DEFAULT_DISCOUNT_POLICY } });
  });

  it('is gated behind settings:write — a manager (settings:read only) is forbidden', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const res = await request(app)
      .patch('/api/settings/business')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ discountPolicy: { managerCanApply: false } });
    expect(res.status).toBe(403);
  });

  it('an admin can update a policy field, merged over the current stored value', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });

    const res = await request(app)
      .patch('/api/settings/business')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ discountPolicy: { supervisorCanApply: true } });

    expect(res.status).toBe(200);
    const policy = await getDiscountPolicy(prisma);
    expect(policy.supervisorCanApply).toBe(true);
    expect(policy.managerCanApply).toBe(true); // untouched field preserved, not reset to some other default
    expect(policy.cashierCanApply).toBe(false); // untouched field preserved
  });

  it('rejects an unknown discountPolicy field', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const res = await request(app)
      .patch('/api/settings/business')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ discountPolicy: { notARealField: true } });
    expect(res.status).toBe(400);
  });

  it('rejects a non-object discountPolicy', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const res = await request(app)
      .patch('/api/settings/business')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ discountPolicy: 'strict' });
    expect(res.status).toBe(400);
  });

  it('a partial update does not silently reset previously-set fields', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });

    await request(app)
      .patch('/api/settings/business')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ discountPolicy: { cashierCanRequest: true } });

    await request(app)
      .patch('/api/settings/business')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ discountPolicy: { supervisorCanApply: true } });

    const policy = await getDiscountPolicy(prisma);
    expect(policy.cashierCanRequest).toBe(true); // set by the first call, preserved by the second
    expect(policy.supervisorCanApply).toBe(true); // set by the second call
  });
});
