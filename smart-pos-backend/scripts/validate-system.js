/**
 * End-to-end system validation
 * Usage: node scripts/validate-system.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const BASE = 'http://localhost:4000';
const MOCK = 'http://localhost:8090';

const results = [];

function pass(name, ok, detail) {
  results.push({ test: name, pass: ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} - ${detail}`);
}

function request(method, url, body, token, expectStatus) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let parsed = raw;
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (_) {}
        if (expectStatus) {
          if (res.statusCode === expectStatus) {
            resolve({ status: res.statusCode, data: parsed });
          } else {
            reject(new Error(`Expected ${expectStatus}, got ${res.statusCode}: ${raw}`));
          }
        } else if (res.statusCode >= 400) {
          const err = new Error(`${res.statusCode}: ${typeof parsed === 'object' ? JSON.stringify(parsed) : raw}`);
          err.status = res.statusCode;
          err.data = parsed;
          reject(err);
        } else {
          resolve(parsed);
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function startProcess(script) {
  return spawn('node', [script], {
    cwd: ROOT,
    env: { ...process.env, PORT: '4000' },
    stdio: 'ignore',
    detached: true,
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runStockConsistencyCheck() {
  try {
    execSync('node scripts/verify-stock-consistency.js', { cwd: ROOT, stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

async function main() {
  console.log('\n=== Smart POS System Validation ===\n');

  pass('Node.js', true, process.version);

  let prisma;
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    const users = await prisma.user.count();
    pass('PostgreSQL', true, `Connected (${users} users)`);
  } catch (e) {
    pass('PostgreSQL', false, e.message);
    console.log('\nStart Postgres: npm run db:up\n');
    process.exit(1);
  }

  try {
    execSync('node scripts/seed-inventory.js', { cwd: ROOT, stdio: 'pipe' });
    pass('Inventory seed', true, 'Stock and batches reset for validation');
  } catch (e) {
    pass('Inventory seed', false, e.stderr?.toString() || e.message);
  }

  try {
    execSync('node scripts/register-seed-products.js', { cwd: ROOT, stdio: 'pipe' });
    pass('Product registration', true, 'Seed products registered with mock VSDC');
  } catch (e) {
    pass('Product registration', false, e.stderr?.toString() || e.message);
  }

  const mockProc = startProcess('mock-vsdc-server.js');
  const apiProc = startProcess('index.js');
  await sleep(3500);

  try {
    const mockHealth = await request('GET', `${MOCK}/health`);
    pass('Mock VSDC', true, mockHealth.message || 'running');
  } catch (e) {
    pass('Mock VSDC', false, e.message);
  }

  try {
    const health = await request('GET', `${BASE}/api/health`);
    pass('API health', health.status === 'healthy', health.message);
  } catch (e) {
    pass('API health', false, e.message);
  }

  let token;
  try {
    const login = await request('POST', `${BASE}/api/users/login`, {
      email: 'admin@smartpos.com',
      password: 'admin123',
    });
    token = login.token;
    pass('Auth login', !!token, 'admin@smartpos.com');
  } catch (e) {
    pass('Auth login', false, e.message);
  }

  try {
    const products = await request('GET', `${BASE}/api/products`, null, token);
    const list = Array.isArray(products) ? products : [];
    const registered = list.filter((p) => p.zraRegistrationStatus === 'REGISTERED').length;
    pass('Products API', list.length > 0, `${list.length} product(s)`);
    pass('All products registered', registered === list.length, `${registered}/${list.length} REGISTERED`);
  } catch (e) {
    pass('Products API', false, e.message);
    pass('All products registered', false, 'skipped');
  }

  try {
    const inv = await request('GET', `${BASE}/api/inventory`, null, token);
    const n = inv.inventory ? inv.inventory.length : 0;
    pass('Inventory API', true, `${n} item(s)`);
  } catch (e) {
    pass('Inventory API', false, e.message);
  }

  let saleId;
  try {
    const profile = await request('GET', `${BASE}/api/users/profile`, null, token);
    const products = await request('GET', `${BASE}/api/products`, null, token);
    const list = Array.isArray(products) ? products : [];
    const product = list.find((p) => p.zraRegistrationStatus === 'REGISTERED') || list[0];
    if (!product) throw new Error('No products - run: node scripts/seed-inventory.js');

    const sale = await request('POST', `${BASE}/api/sales/checkout`, {
      userId: profile.id,
      paymentMethod: 'CASH',
      tax: 0,
      discount: 0,
      items: [{ productId: product.id, quantity: 1, price: product.price }],
    }, token);
    saleId = sale.sale?.id;
    const rcpt = sale.fiscal?.rcptNo;
    pass('Create sale', !!saleId, `Sale ${saleId}`);
    pass('ZRA invoice', !!rcpt, rcpt || 'no receipt');
  } catch (e) {
    pass('Create sale', false, e.message);
    pass('ZRA invoice', false, 'skipped');
  }

  let refundId;
  if (saleId && token) {
    try {
      const profile = await request('GET', `${BASE}/api/users/profile`, null, token);
      const refund = await request(
        'POST',
        `${BASE}/api/sales/${saleId}/refund`,
        { userId: profile.id, reasonCode: '01', reason: 'Validation test refund' },
        token
      );
      refundId = refund.refund?.id;
      const crn = refund.fiscal?.rcptNo;
      pass('Credit note refund', !!refundId && !!crn, crn || 'no credit receipt');
    } catch (e) {
      pass('Credit note refund', false, e.message);
    }
  } else {
    pass('Credit note refund', false, 'skipped');
  }

  if (saleId && token) {
    let movement;
    try {
      await sleep(2000);
      movement = await prisma.stockMovement.findFirst({
        where: { referenceId: saleId, movementType: 'SALE_OUT' },
      });
      pass('Stock movement synced', !!movement?.zraSyncedAt, movement?.zraSyncedAt ? 'zraSyncedAt set' : 'missing');
    } catch (e) {
      pass('Stock movement synced', false, e.message);
    }

    try {
      const sync = await request('POST', `${BASE}/api/vsdc/stock/sync`, { referenceId: saleId }, token);
      const syncOk = sync.succeeded >= 1 || !!movement?.zraSyncedAt;
      pass(
        'VSDC stock sync',
        syncOk,
        movement?.zraSyncedAt && sync.attempted === 0
          ? 'already synced via post-sale hook'
          : `${sync.succeeded}/${sync.attempted} synced`
      );
    } catch (e) {
      pass('VSDC stock sync', !!movement?.zraSyncedAt, e.message);
    }
  } else {
    pass('VSDC stock sync', false, 'skipped');
    pass('Stock movement synced', false, 'skipped');
  }

  const consistent = await runStockConsistencyCheck();
  pass('Stock batch consistency', consistent, consistent ? 'currentStock matches batch sum' : 'drift detected');

  try {
    const products = await request('GET', `${BASE}/api/products`, null, token);
    const list = Array.isArray(products) ? products : [];
    const testProduct = list.find((p) => p.sku === 'COKE500') || list[0];
    if (testProduct && prisma) {
      await prisma.product.update({
        where: { id: testProduct.id },
        data: { zraRegistrationStatus: 'PENDING' },
      });
      const profile = await request('GET', `${BASE}/api/users/profile`, null, token);
      try {
        await request(
          'POST',
          `${BASE}/api/sales/checkout`,
          {
            userId: profile.id,
            paymentMethod: 'CASH',
            tax: 0,
            discount: 0,
            items: [{ productId: testProduct.id, quantity: 1, price: testProduct.price }],
          },
          token,
          409
        );
        pass('Unregistered checkout blocked', true, 'HTTP 409');
      } catch (e) {
        pass('Unregistered checkout blocked', false, e.message);
      }
      execSync('node scripts/register-seed-products.js', { cwd: ROOT, stdio: 'pipe' });
    } else {
      pass('Unregistered checkout blocked', false, 'no product for test');
    }
  } catch (e) {
    pass('Unregistered checkout blocked', false, e.message);
  }

  if (prisma) await prisma.$disconnect();

  try {
    process.kill(-mockProc.pid);
  } catch (_) {
    mockProc.kill();
  }
  try {
    process.kill(-apiProc.pid);
  } catch (_) {
    apiProc.kill();
  }

  console.log('\n=== Summary ===\n');
  console.table(results);
  const failed = results.filter((r) => !r.pass).length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
