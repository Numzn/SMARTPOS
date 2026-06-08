/**
 * End-to-end system validation
 * Usage: node scripts/validate-system.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawn } = require('child_process');
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

function request(method, url, body, token) {
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
        if (res.statusCode >= 400) {
          reject(new Error(`${res.statusCode}: ${typeof parsed === 'object' ? JSON.stringify(parsed) : raw}`));
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

async function main() {
  console.log('\n=== Smart POS System Validation ===\n');

  pass('Node.js', true, process.version);

  // Database
  let dbOk = false;
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    const users = await prisma.user.count();
    await prisma.$disconnect();
    dbOk = true;
    pass('PostgreSQL', true, `Connected (${users} users)`);
  } catch (e) {
    pass('PostgreSQL', false, e.message);
    console.log('\nStart Postgres: npm run db:up\n');
    process.exit(1);
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
    pass('Products API', list.length > 0, `${list.length} product(s)`);
  } catch (e) {
    pass('Products API', false, e.message);
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
    const product = list[0];
    if (!product) throw new Error('No products - run: npx prisma db seed');

    await request('POST', `${BASE}/api/inventory/receive`, {
      productId: product.id,
      quantity: 50,
      unitCost: 1,
      branchId: 'main',
    }, token);

    const sale = await request('POST', `${BASE}/api/sales`, {
      userId: profile.id,
      paymentMethod: 'CASH',
      items: [{ productId: product.id, quantity: 1, price: product.price }],
    }, token);
    saleId = sale.id;
    pass('Create sale', !!saleId, `Sale ${saleId}`);
  } catch (e) {
    pass('Create sale', false, e.message);
  }

  if (saleId) {
    try {
      const zra = await request('POST', `${BASE}/api/zra/send-invoice/${saleId}`, null, token);
      const rcpt = zra.sale?.rcptNo || zra.zraResponse?.rcptNo;
      pass('ZRA invoice', !!rcpt, rcpt || 'no receipt');
    } catch (e) {
      pass('ZRA invoice', false, e.message);
    }
  }

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
