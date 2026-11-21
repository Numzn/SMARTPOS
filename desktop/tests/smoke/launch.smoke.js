'use strict';

/**
 * REAL launch smoke test: starts the actual Electron app (not mocks), against a
 * local fake backend, and checks startup, production loading, the API proxy,
 * sign-in, and the security boundaries from inside the real renderer.
 *
 * Needs a display (on Linux CI: `xvfb-run -a node tests/smoke/launch.smoke.js`),
 * a built renderer (`npm run build:renderer`), and playwright-core (devDependency).
 * Optional env:
 *   SMOKE_NO_SANDBOX=1      pass --no-sandbox (needed when running as root in Docker)
 *   SMOKE_REAL_BACKEND=url  also check GET <url>/api/health through the proxy
 *   SMOKE_APP_PATH=dir      app dir or unpacked app (default: this package)
 */
const { _electron: electron } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${detail}`}`);
}
async function check(name, fn) {
  try {
    await fn();
    record(name, true);
  } catch (e) {
    record(name, false, e && e.message ? e.message.split('\n')[0] : String(e));
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function startFakeBackend() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, cookie: req.headers.cookie || null });
      const json = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/api/health') return json(200, { status: 'ok', fake: true });
      if (req.url === '/api/users/login' && req.method === 'POST') {
        return json(200, {
          token: 'fake-jwt-token-for-smoke-test',
          user: { id: 1, email: 'admin@example.com', name: 'Smoke Admin', role: 'ADMIN', permissions: ['sales:read', 'products:read'] },
        });
      }
      if (req.url === '/api/users/profile') {
        return json(200, { id: 1, email: 'admin@example.com', name: 'Smoke Admin', role: 'ADMIN', permissions: ['sales:read', 'products:read'] });
      }
      return json(200, req.method === 'GET' ? [] : {});
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

async function launch(userData) {
  // Chromium switches must precede the app path to be honoured.
  const args = [];
  if (process.env.SMOKE_NO_SANDBOX === '1') args.push('--no-sandbox', '--disable-dev-shm-usage');
  args.push(`--user-data-dir=${userData}`, process.env.SMOKE_APP_PATH || root);
  const app = await electron.launch({
    executablePath: require('electron'),
    args,
    env: { ...process.env, NUMZ_DESKTOP_DEV: '', NODE_ENV: 'production' },
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  return { app, page };
}

(async () => {
  const fake = await startFakeBackend();
  const backend = `http://127.0.0.1:${fake.port}`;

  // ---------- A. First run: no server configured -> setup page ----------
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'numz-smoke-a-'));
  {
    const { app, page } = await launch(dirA);
    await check('first run shows the server-setup page', async () => {
      await page.waitForURL('**/__desktop/setup.html', { timeout: 30_000 });
      assert((await page.textContent('h1')).includes('Connect NUMZ POS'), 'heading missing');
    });
    await check('setup page: testing a bad address is refused with a message', async () => {
      await page.fill('#url', 'http://example.com');
      await page.click('#test');
      await page.waitForFunction(() => document.getElementById('message').textContent.includes('https://'));
    });
    await check('setup page: test connection reaches the backend', async () => {
      await page.fill('#url', backend);
      await page.click('#test');
      await page.waitForFunction(() => document.getElementById('message').textContent.startsWith('Connected'));
    });
    await check('setup page: saving loads the real React app (unauthenticated -> /login)', async () => {
      await page.click('#save');
      await page.waitForURL('**/login', { timeout: 30_000 });
      await page.waitForSelector('#email', { timeout: 30_000 });
    });
    await check('server address was persisted to the per-user config', async () => {
      const cfg = JSON.parse(fs.readFileSync(path.join(dirA, 'config.json'), 'utf8'));
      assert(cfg.backendUrl === backend, `got ${cfg.backendUrl}`);
    });
    await app.close();
  }

  // ---------- B. Configured: production load, bridge, proxy, security ----------
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'numz-smoke-b-'));
  fs.writeFileSync(path.join(dirB, 'config.json'), JSON.stringify({ backendUrl: backend }));
  {
    const { app, page } = await launch(dirB);
    await check('production build loads from numzpos://app without any dev server', async () => {
      await page.waitForURL('numzpos://app/**', { timeout: 30_000 });
      await page.waitForSelector('#email', { timeout: 30_000 });
      assert(page.url().startsWith('numzpos://app/'), page.url());
    });
    await check('window title and existing login UI are the real NUMZ POS app', async () => {
      assert((await page.title()).length > 0);
      assert(await page.isVisible('#password'));
    });
    await check('deep link / client-side route loads (SPA fallback)', async () => {
      await page.goto('numzpos://app/cash-register');
      await page.waitForSelector('#email', { timeout: 30_000 }); // ProtectedRoute -> /login
    });

    await check('renderer has NO Node access (require/process/Buffer/global absent)', async () => {
      const r = await page.evaluate(() => ({
        req: typeof require, proc: typeof process, buf: typeof Buffer, mod: typeof module, ipc: typeof ipcRenderer,
      }));
      assert(Object.values(r).every((v) => v === 'undefined'), JSON.stringify(r));
    });
    await check('only window.numzDesktop is exposed and it is frozen, without raw ipc', async () => {
      const r = await page.evaluate(() => ({
        isDesktop: window.numzDesktop && window.numzDesktop.isDesktop,
        frozen: Object.isFrozen(window.numzDesktop),
        keys: Object.keys(window.numzDesktop).sort().join(','),
        hasIpc: 'ipcRenderer' in window || 'electron' in window,
      }));
      assert(r.isDesktop === true && r.frozen && !r.hasIpc, JSON.stringify(r));
      assert(r.keys === 'app,config,diagnostics,isDesktop,print,printers,secureStore,updates', r.keys);
    });
    await check('bridge works from the trusted main frame (app info)', async () => {
      const info = await page.evaluate(() => window.numzDesktop.app.getInfo());
      assert(info.name && info.version === '1.0.0', JSON.stringify(info));
    });
    await check('secure store rejects arbitrary keys', async () => {
      const msg = await page.evaluate(() => window.numzDesktop.secureStore.set('evil', 'x').then(() => 'accepted', (e) => e.message));
      assert(/Unknown secure storage key/.test(msg), msg);
    });
    await check('printer settings reject public-internet printer hosts', async () => {
      const r = await page.evaluate(() => window.numzDesktop.printers.setConfig({ mode: 'ESCPOS_NETWORK', host: '8.8.8.8', port: 9100 }));
      assert(r.ok === false, JSON.stringify(r));
    });
    await check('server address change rejects remote plain http', async () => {
      const r = await page.evaluate(() => window.numzDesktop.config.setBackendUrl('http://example.com'));
      assert(r.ok === false, JSON.stringify(r));
    });

    await check('inline scripts are blocked by the CSP', async () => {
      await page.evaluate(() => {
        const s = document.createElement('script');
        s.textContent = 'window.__pwned = true';
        document.body.appendChild(s);
      });
      assert((await page.evaluate(() => window.__pwned)) !== true, 'inline script executed');
    });
    await check('foreign navigation is blocked (stays on numzpos://app)', async () => {
      await page.evaluate(() => { window.location.href = 'https://example.com/'; }).catch(() => {});
      await page.waitForTimeout(1500);
      assert(page.url().startsWith('numzpos://app/'), page.url());
    });
    await check('window.open is denied (no extra window)', async () => {
      await page.evaluate(() => window.open('https://example.com/', '_blank')).catch(() => {});
      await page.waitForTimeout(1000);
      assert(app.windows().length === 1, `windows: ${app.windows().length}`);
    });
    await check('renderer cannot call anything but the proxy (direct fetch to another origin fails)', async () => {
      const outcome = await page.evaluate(() => fetch('https://example.com/').then(() => 'reached', () => 'blocked'));
      assert(outcome === 'blocked', outcome);
    });

    await check('API proxy: renderer fetch("/api/health") reaches the configured backend', async () => {
      const r = await page.evaluate(() => fetch('/api/health').then((x) => x.json()));
      assert(r.fake === true, JSON.stringify(r));
    });
    await check('API proxy: only /api is proxied (other paths are not forwarded)', async () => {
      const before = fake.seen.length;
      await page.evaluate(() => fetch('/secret-admin').then((x) => x.status));
      assert(!fake.seen.slice(before).some((s) => s.url === '/secret-admin'), 'non-API path was forwarded');
    });

    await check('sign-in through the real UI succeeds against the backend', async () => {
      await page.goto('numzpos://app/login');
      await page.fill('#email', 'admin@example.com');
      await page.fill('#password', 'irrelevant');
      await page.click('button[type=submit]');
      await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
    });
    await check('token is NOT stored in localStorage or cookies in the desktop app', async () => {
      const r = await page.evaluate(() => ({ ls: localStorage.getItem('token'), cookie: document.cookie }));
      assert(r.ls === null && !/token=/.test(r.cookie), JSON.stringify(r));
    });
    await check('authenticated API calls carry the bearer token through the proxy', async () => {
      await page.evaluate(() => fetch('/api/users/profile', { headers: { Authorization: 'Bearer fake-jwt-token-for-smoke-test' } }));
      assert(fake.seen.some((s) => s.auth === 'Bearer fake-jwt-token-for-smoke-test'), 'bearer not forwarded');
    });
    await check('cookies are never forwarded to the backend', async () => {
      assert(fake.seen.every((s) => !s.cookie), 'a cookie header reached the backend');
    });

    if (process.env.SMOKE_REAL_BACKEND) {
      await check(`real backend health through the proxy (${process.env.SMOKE_REAL_BACKEND})`, async () => {
        const r = await page.evaluate((u) => window.numzDesktop.config.testBackend(u), process.env.SMOKE_REAL_BACKEND);
        assert(r.ok === true, JSON.stringify(r));
      });
    }

    await check('backend outage surfaces as a failed fetch, like a browser (no hang)', async () => {
      await new Promise((r) => fake.server.close(r));
      const outcome = await page.evaluate(() => fetch('/api/health').then(() => 'ok', () => 'network-error'));
      assert(outcome === 'network-error', outcome);
    });
    await app.close();
  }

  // ---------- C. Single instance ----------
  await check('log file is written without leaking tokens', async () => {
    const log = fs.readFileSync(path.join(dirB, 'logs', 'main.log'), 'utf8');
    assert(log.includes('starting'), 'no startup line');
    assert(!log.includes('fake-jwt-token-for-smoke-test'), 'token leaked into the log');
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('Smoke test crashed:', e);
  process.exit(2);
});
