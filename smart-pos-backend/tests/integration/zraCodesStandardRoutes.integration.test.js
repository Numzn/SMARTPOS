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

// Section 5 UI layer (zra-self-checklist.md item 8*): backs the Tax Type /
// Package Unit / Quantity Unit selectors in ProductModal.jsx. Small bounded
// lists, so no search/pagination — just "the current usable set."
describe('GET /api/items/tax-types, /package-units, /quantity-units', () => {
  const app = createTestApp('/api/items', itemsRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await prisma.zraCode.deleteMany({ where: { code: { startsWith: 'ROUTE-STD-' } } });
    await cleanupTestData();
  });

  it('GET /tax-types returns codes synced under class 04', async () => {
    await prisma.zraCode.upsert({
      where: { codeClass_code: { codeClass: '04', code: 'ROUTE-STD-TAX' } },
      create: { codeClass: '04', code: 'ROUTE-STD-TAX', name: 'Route Test Tax', syncedAt: new Date() },
      update: { syncedAt: new Date() },
    });

    const user = await createTestUser({ role: 'MANAGER' });
    const res = await request(app)
      .get('/api/items/tax-types')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.codes.some((c) => c.code === 'ROUTE-STD-TAX')).toBe(true);
  });

  it('GET /package-units returns codes synced under class 17', async () => {
    await prisma.zraCode.upsert({
      where: { codeClass_code: { codeClass: '17', code: 'ROUTE-STD-PKG' } },
      create: { codeClass: '17', code: 'ROUTE-STD-PKG', name: 'Route Test Package', syncedAt: new Date() },
      update: { syncedAt: new Date() },
    });

    const user = await createTestUser({ role: 'MANAGER' });
    const res = await request(app)
      .get('/api/items/package-units')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.codes.some((c) => c.code === 'ROUTE-STD-PKG')).toBe(true);
  });

  it('GET /quantity-units returns codes synced under class 10', async () => {
    await prisma.zraCode.upsert({
      where: { codeClass_code: { codeClass: '10', code: 'ROUTE-STD-QTY' } },
      create: { codeClass: '10', code: 'ROUTE-STD-QTY', name: 'Route Test Quantity', syncedAt: new Date() },
      update: { syncedAt: new Date() },
    });

    const user = await createTestUser({ role: 'MANAGER' });
    const res = await request(app)
      .get('/api/items/quantity-units')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.codes.some((c) => c.code === 'ROUTE-STD-QTY')).toBe(true);
  });

  it('all three routes are gated behind authentication', async () => {
    const paths = ['/api/items/tax-types', '/api/items/package-units', '/api/items/quantity-units'];
    for (const path of paths) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  });
});
