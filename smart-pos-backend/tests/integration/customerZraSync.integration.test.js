import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestBranch, createTestUser, createTestCustomer, cleanupTestData, prisma } = testData;
const { createTestApp } = testApp;

// routes/customers.js destructures nothing from vsdc-gateway at require-time
// (it's required lazily inside the handler), so a direct property patch on
// the gateway singleton is intercepted correctly — no CJS destructuring gap
// here, unlike some of the earlier route fixes.
const vsdcGateway = require('../../lib/vsdc-gateway');
vsdcGateway.saveBranchCustomer = vi.fn();
vsdcGateway.selectCustomer = vi.fn();

const customersRouter = require('../../routes/customers.js');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

describe('POST /api/customers/:id/zra-sync', () => {
  const app = createTestApp('/api/customers', customersRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    vsdcGateway.saveBranchCustomer.mockReset();
    await cleanupTestData();
  });

  it('REGRESSION: rejects a customer with no TPIN before ever calling VSDC', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const customer = await createTestCustomer({ tpin: null });

    const res = await request(app)
      .post(`/api/customers/${customer.id}/zra-sync`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no TPIN/);
    expect(vsdcGateway.saveBranchCustomer).not.toHaveBeenCalled();
  });

  it('REGRESSION: syncs a customer with a TPIN and returns the updated record', async () => {
    vsdcGateway.saveBranchCustomer.mockImplementation(async (customer) => {
      await prisma.customer.update({ where: { id: customer.id }, data: { zraSyncedAt: new Date() } });
      return { success: true };
    });
    const manager = await createTestUser({ role: 'MANAGER' });
    const customer = await createTestCustomer({ tpin: '2000000456' });

    const res = await request(app)
      .post(`/api/customers/${customer.id}/zra-sync`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(200);
    expect(res.body.customer.zraSyncedAt).toBeTruthy();
    expect(vsdcGateway.saveBranchCustomer).toHaveBeenCalled();
  });

  it('REGRESSION: surfaces a ZRA rejection as 422, not a silent success', async () => {
    vsdcGateway.saveBranchCustomer.mockRejectedValue(new Error('ZRA rejected: duplicate TPIN'));
    const manager = await createTestUser({ role: 'MANAGER' });
    const customer = await createTestCustomer({ tpin: '2000000789' });

    const res = await request(app)
      .post(`/api/customers/${customer.id}/zra-sync`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/duplicate TPIN/);
  });

  it('REGRESSION: is gated behind zra:sync, not customers:write', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const customer = await createTestCustomer({ tpin: '2000000111' });

    const res = await request(app)
      .post(`/api/customers/${customer.id}/zra-sync`)
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);

    // Gated behind zra:sync, not customers:write — a cashier can quick-add
    // a customer at checkout (has customers:write) but pushing fiscal data
    // to ZRA is an admin/manager-tier action, same permission tier as the
    // existing codes/sync endpoint.
    expect(res.status).toBe(403);
    expect(vsdcGateway.saveBranchCustomer).not.toHaveBeenCalled();
  });
});

describe('GET /api/customers/zra-lookup', () => {
  const app = createTestApp('/api/customers', customersRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    vsdcGateway.selectCustomer.mockReset();
    await cleanupTestData();
  });

  it('REGRESSION: is reachable and not swallowed by the /:id route (routing order regression)', async () => {
    vsdcGateway.selectCustomer.mockResolvedValue({ found: true, customer: { custNm: 'Jane ZRA' } });
    const manager = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .get('/api/customers/zra-lookup?tpin=2000000123')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.customer.custNm).toBe('Jane ZRA');
    expect(vsdcGateway.selectCustomer).toHaveBeenCalledWith('2000000123');
  });

  it('requires a tpin query parameter', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });

    const res = await request(app)
      .get('/api/customers/zra-lookup')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(400);
  });
});
