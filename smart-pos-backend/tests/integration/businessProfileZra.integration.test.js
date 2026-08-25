import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import settingsRouter from '../../routes/settings.js';
import { ensureDefaultBusinessProfile } from '../../lib/ensureBusinessProfile.js';

const { createTestUser, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

// PATCH /api/settings/business's zraEnabled field — a receipt-display switch
// only (see prisma/schema.prisma's BusinessProfile.zraEnabled comment). Does
// not touch VSDC submission — that's lib/saleFiscal.js, untested here.
describe('PATCH /api/settings/business — zraEnabled', () => {
  const app = createTestApp('/api/settings', settingsRouter);

  beforeAll(async () => {
    await ensureDefaultBusinessProfile();
  });

  afterEach(async () => {
    await cleanupTestData();
    await prisma.businessProfile.update({ where: { id: 'default' }, data: { zraEnabled: false } });
  });

  it('defaults to false on a fresh business profile', async () => {
    const profile = await prisma.businessProfile.findUnique({ where: { id: 'default' } });
    expect(profile.zraEnabled).toBe(false);
  });

  it('is gated behind settings:write — a manager (settings:read only) is forbidden', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const res = await request(app)
      .patch('/api/settings/business')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ zraEnabled: true });
    expect(res.status).toBe(403);
  });

  it('an admin can turn it on', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const res = await request(app)
      .patch('/api/settings/business')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ zraEnabled: true });

    expect(res.status).toBe(200);
    expect(res.body.zraEnabled).toBe(true);
    const profile = await prisma.businessProfile.findUnique({ where: { id: 'default' } });
    expect(profile.zraEnabled).toBe(true);
  });

  it('an admin can turn it back off', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await prisma.businessProfile.update({ where: { id: 'default' }, data: { zraEnabled: true } });

    const res = await request(app)
      .patch('/api/settings/business')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ zraEnabled: false });

    expect(res.status).toBe(200);
    expect(res.body.zraEnabled).toBe(false);
  });

  it('leaves zraEnabled untouched when omitted from the request body', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await prisma.businessProfile.update({ where: { id: 'default' }, data: { zraEnabled: true } });

    const res = await request(app)
      .patch('/api/settings/business')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ tradingName: 'Unrelated Update Co' });

    expect(res.status).toBe(200);
    expect(res.body.zraEnabled).toBe(true);
  });
});
