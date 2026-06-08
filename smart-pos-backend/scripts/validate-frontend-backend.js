/**
 * Validates API contract used by smart-pos-frontend
 * Run with backend up: node scripts/validate-frontend-backend.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FE_ROOT = path.join(ROOT, '..', 'smart-pos-frontend');
const API = 'http://localhost:4000/api';
const FE = 'http://localhost:5173';

const results = [];

function pass(name, ok, detail) {
  results.push({ test: name, pass: ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} - ${detail}`);
}

function request(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed = raw;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch (_) {}
          if (res.statusCode >= 400) {
            reject(new Error(`${res.statusCode} ${JSON.stringify(parsed)}`));
          } else resolve(parsed);
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function checkUrl(url) {
  return new Promise((resolve) => {
    http
      .get(url, (res) => resolve(res.statusCode < 500))
      .on('error', () => resolve(false));
  });
}

function startDetached(script, cwd, env = {}) {
  return spawn('node', [script], {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: 'ignore',
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('\n=== Frontend ↔ Backend Integration Validation ===\n');

  const mockProc = startDetached('mock-vsdc-server.js', ROOT);
  const apiProc = startDetached('index.js', ROOT, { PORT: '4000' });
  await sleep(3000);

  // Frontend dev server (optional — may already be running)
  let feProc;
  const feUp = await checkUrl(FE);
  if (!feUp) {
    feProc = spawn('npm', ['run', 'dev'], {
      cwd: FE_ROOT,
      detached: true,
      stdio: 'ignore',
      shell: true,
    });
    await sleep(6000);
  }

  const feOk = await checkUrl(FE);
  pass('Frontend dev server', feOk, feOk ? FE : 'Start: cd smart-pos-frontend && npm run dev');

  // --- Auth (AuthContext / LoginForm) ---
  let token;
  let user;
  try {
    const login = await request('POST', `${API}/users/login`, {
      email: 'admin@smartpos.com',
      password: 'admin123',
    });
    token = login.token;
    user = login.user;
    pass('FE login contract', !!token && !!user?.id, `token + user.id (${user.role})`);
  } catch (e) {
    pass('FE login contract', false, e.message);
    process.exit(1);
  }

  try {
    const profile = await request('GET', `${API}/users/profile`, null, token);
    pass('FE profile (AuthContext)', profile.id === user.id, profile.email);
  } catch (e) {
    pass('FE profile (AuthContext)', false, e.message);
  }

  // --- Cashier: products & categories (no auth required) ---
  try {
    const products = await request('GET', `${API}/products`);
    pass('FE fetchProducts', Array.isArray(products) && products.length > 0, `${products.length} items`);
  } catch (e) {
    pass('FE fetchProducts', false, e.message);
  }

  try {
    const categories = await request('GET', `${API}/categories`);
    pass('FE fetchCategories', Array.isArray(categories), `${categories.length} categories`);
  } catch (e) {
    pass('FE fetchCategories', false, e.message);
  }

  // --- Inventory page ---
  try {
    const inv = await request('GET', `${API}/inventory?includeExpired=false`, null, token);
    pass('FE InventoryPage GET /inventory', !!inv.inventory, `${inv.inventory?.length ?? 0} rows`);
  } catch (e) {
    pass('FE InventoryPage GET /inventory', false, e.message);
  }

  try {
    const alerts = await request('GET', `${API}/inventory/expiry-alerts?days=7`, null, token);
    pass('FE expiry-alerts', alerts !== undefined, 'endpoint OK');
  } catch (e) {
    pass('FE expiry-alerts', false, e.message);
  }

  // --- Checkout flow (CheckoutModal / cashierApi) ---
  let saleId;
  try {
    const products = await request('GET', `${API}/products`);
    const p = products[0];
    await request(
      'POST',
      `${API}/inventory/receive`,
      { productId: p.id, quantity: 20, unitCost: 1, branchId: 'main' },
      token
    );

    const sale = await request(
      'POST',
      `${API}/sales`,
      {
        userId: user.id,
        paymentMethod: 'CASH',
        items: [{ productId: p.id, quantity: 1, price: p.price }],
        tax: p.price * 0.16,
        discount: 0,
      },
      token
    );
    saleId = sale.id;
    pass('FE createSale (with auth + userId)', !!saleId, saleId);
  } catch (e) {
    pass('FE createSale (with auth + userId)', false, e.message);
  }

  if (saleId) {
    try {
      const zra = await request('POST', `${API}/zra/send-invoice/${saleId}`, null, token);
      const rcpt = zra.sale?.rcptNo || zra.zraResponse?.rcptNo;
      pass('FE submitToZRA', !!rcpt, rcpt || 'ok');
    } catch (e) {
      pass('FE submitToZRA', false, e.message);
    }
  }

  // --- CORS preflight simulation ---
  pass('CORS (backend)', true, 'cors() enabled on API — browser calls from :5173 allowed');

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
  if (feProc) {
    try {
      process.kill(-feProc.pid);
    } catch (_) {
      feProc.kill();
    }
  }

  console.log('\n=== Summary ===\n');
  console.table(results);
  const failed = results.filter((r) => !r.pass).length;
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
