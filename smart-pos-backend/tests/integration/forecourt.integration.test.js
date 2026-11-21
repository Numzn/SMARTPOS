import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';
import forecourtRoutes from '../../routes/forecourt/index.js';

const {
  createTestBranch,
  createTestUser,
  createTestProduct,
  createTestAttendant,
  createTestPump,
  cleanupTestData,
  DEFAULT_BRANCH_CODE,
} = testData;
const { createTestApp } = testApp;

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

describe('routes/forecourt — Phase 1 CRUD/seed routes', () => {
  const app = createTestApp('/api/forecourt', forecourtRoutes);

  afterEach(async () => {
    await cleanupTestData();
  });

  it('POST /attendants is gated behind forecourt:write — a cashier is forbidden', async () => {
    await createTestBranch();
    const cashier = await createTestUser({ role: 'CASHIER' });
    const res = await request(app)
      .post('/api/forecourt/attendants')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`)
      .send({ name: 'John Mwansa', attendantCode: 'TEST-ATT-F1', branchId: DEFAULT_BRANCH_CODE });
    expect(res.status).toBe(403);
  });

  it('GET /attendants is allowed for a cashier (forecourt:read)', async () => {
    await createTestBranch();
    const cashier = await createTestUser({ role: 'CASHIER' });
    const res = await request(app).get('/api/forecourt/attendants').set('Authorization', `Bearer ${tokenFor(cashier)}`);
    expect(res.status).toBe(200);
  });

  it('an admin can create an attendant and a pump', async () => {
    await createTestBranch();
    const admin = await createTestUser({ role: 'ADMIN' });

    const attRes = await request(app)
      .post('/api/forecourt/attendants')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ name: 'John Mwansa', attendantCode: 'TEST-ATT-F2', branchId: DEFAULT_BRANCH_CODE });
    expect(attRes.status).toBe(201);
    expect(attRes.body.status).toBe('ACTIVE');

    const pumpRes = await request(app)
      .post('/api/forecourt/pumps')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ code: 'TEST-PUMP-F2', name: 'Pump 4', branchId: DEFAULT_BRANCH_CODE });
    expect(pumpRes.status).toBe(201);
    expect(pumpRes.body.status).toBe('ACTIVE');
  });

  it('a B2B fuel transaction is fiscalized immediately via the mock adapter', async () => {
    await createTestBranch();
    const admin = await createTestUser({ role: 'ADMIN' });
    const attendant = await createTestAttendant();
    const pump = await createTestPump();
    const product = await createTestProduct({ unit: 'L', name: 'Diesel' });

    const res = await request(app)
      .post('/api/forecourt/transactions')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({
        pumpId: pump.id,
        attendantId: attendant.id,
        productId: product.id,
        volume: 30,
        customerType: 'B2B',
      });

    expect(res.status).toBe(201);
    expect(res.body.settlementStatus).toBe('UNSETTLED');
    expect(res.body.fiscalStatus).toBe('FISCALIZED');
    expect(res.body.fiscalRecordId).toBeTruthy();
    expect(res.body.fiscalRecord.provider).toBe('mock');
    expect(res.body.fiscalRecord.rcptNo).toMatch(/^MOCK-/);
    expect(res.body.amount).toBe(30 * product.price);
  });

  it('an ordinary B2C fuel transaction (no invoice requested) is deferred to SUMMARY_PENDING, not fiscalized', async () => {
    await createTestBranch();
    const admin = await createTestUser({ role: 'ADMIN' });
    const attendant = await createTestAttendant();
    const pump = await createTestPump();
    const product = await createTestProduct({ unit: 'L', name: 'Petrol' });

    const res = await request(app)
      .post('/api/forecourt/transactions')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ pumpId: pump.id, attendantId: attendant.id, productId: product.id, volume: 12 });

    expect(res.status).toBe(201);
    expect(res.body.fiscalStatus).toBe('SUMMARY_PENDING');
    expect(res.body.fiscalRecordId).toBeFalsy();

    const listRes = await request(app)
      .get(`/api/forecourt/transactions?attendantId=${attendant.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.map((t) => t.id)).toContain(res.body.id);
  });
});
