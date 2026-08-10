import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import testData from '../helpers/testData.js';
import testApp from '../helpers/testApp.js';

const { createTestBranch, createTestUser, cleanupTestData } = testData;
const { createTestApp } = testApp;

// routes/settings.js destructures `runDatabaseBackup` from this module at require-time,
// so the mock must be installed on the (cached) module object before settings.js is
// required — vi.mock's hoisting doesn't reliably intercept plain CJS require() chains.
const backupLib = require('../../lib/backup.js');
backupLib.runDatabaseBackup = vi.fn();
const runDatabaseBackup = backupLib.runDatabaseBackup;

const settingsRouter = require('../../routes/settings.js');

function tokenFor(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

describe('POST /api/settings/backup', () => {
  const app = createTestApp('/api/settings', settingsRouter);

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    runDatabaseBackup.mockReset();
    await cleanupTestData();
  });

  it('REGRESSION: is gated behind settings:write — a cashier is forbidden', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });

    const res = await request(app)
      .post('/api/settings/backup')
      .set('Authorization', `Bearer ${tokenFor(cashier)}`);

    expect(res.status).toBe(403);
    expect(runDatabaseBackup).not.toHaveBeenCalled();
  });

  it('REGRESSION: an admin can trigger a manual backup and the actor is attributed', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    runDatabaseBackup.mockResolvedValue({
      filename: 'smartpos-test.sql.gz',
      filePath: '/tmp/smartpos-test.sql.gz',
      size: 1234,
      durationMs: 42,
      removed: [],
    });

    const res = await request(app)
      .post('/api/settings/backup')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.filename).toBe('smartpos-test.sql.gz');
    expect(runDatabaseBackup).toHaveBeenCalledWith(
      expect.objectContaining({ actor: expect.objectContaining({ userId: admin.id, userRole: 'ADMIN' }) })
    );
  });

  it('REGRESSION: surfaces a pg_dump failure as a 500 instead of a silent success', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    runDatabaseBackup.mockRejectedValue(new Error('pg_dump exited with code 1: connection refused'));

    const res = await request(app)
      .post('/api/settings/backup')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('pg_dump exited with code 1');
  });
});
