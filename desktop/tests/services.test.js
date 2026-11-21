import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { normalizeBackendUrl } = require('../services/backendUrl');
const { createConfigStore, validatePrinterConfig } = require('../services/configStore');
const { createSecureStore } = require('../services/secureStore');
const { resolveStatic } = require('../services/staticResolver');
const { buildProxyTarget, filterRequestHeaders } = require('../services/backendProxy');
const { buildCsp } = require('../services/csp');
const { isAllowedNavigation, isSafeExternalUrl } = require('../services/navigationGuard');
const { sendRaw, applyDrawerPolicy, buildTestPage, looksLikeReceiptViewModel, DRAWER_KICK } = require('../services/escposPrinter');
const { createPrintService } = require('../services/printing');
const { createUpdater } = require('../services/updater');
const { createLogger, redact } = require('../services/logger');
const { checkBackend } = require('../services/diagnostics');

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'numz-desktop-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('backend URL policy', () => {
  it('accepts https and strips path/query/hash down to an origin', () => {
    expect(normalizeBackendUrl('https://pos.example.com/some/path?x=1#h')).toEqual({ ok: true, origin: 'https://pos.example.com' });
  });
  it('allows http only for loopback / private networks', () => {
    expect(normalizeBackendUrl('http://192.168.1.10:4000').ok).toBe(true);
    expect(normalizeBackendUrl('http://localhost:4000').ok).toBe(true);
    expect(normalizeBackendUrl('http://10.0.0.5').ok).toBe(true);
    expect(normalizeBackendUrl('http://172.20.1.1').ok).toBe(true);
    expect(normalizeBackendUrl('http://pos.example.com').ok).toBe(false);
    expect(normalizeBackendUrl('http://8.8.8.8').ok).toBe(false);
    expect(normalizeBackendUrl('http://172.32.0.1').ok).toBe(false);
  });
  it('rejects credentials, other schemes, junk and empty input', () => {
    for (const bad of ['https://u:p@x.com', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://x.com', 'not a url', '', '   ', null, 42]) {
      expect(normalizeBackendUrl(bad).ok).toBe(false);
    }
  });
});

describe('config store', () => {
  it('starts with defaults and persists atomically with user-only permissions', () => {
    const store = createConfigStore({ dir: tmp, fs });
    expect(store.get().backendUrl).toBe('');
    expect(store.setBackendUrl('https://pos.example.com/x').ok).toBe(true);
    const again = createConfigStore({ dir: tmp, fs }).get();
    expect(again.backendUrl).toBe('https://pos.example.com');
    expect(fs.readdirSync(tmp).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(tmp, 'config.json')).mode & 0o077).toBe(0);
  });
  it('survives a corrupt config file instead of crashing startup', () => {
    fs.writeFileSync(path.join(tmp, 'config.json'), '{ not json');
    expect(createConfigStore({ dir: tmp, fs }).get().backendUrl).toBe('');
  });
  it('drops invalid persisted values (tampered file)', () => {
    fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({ backendUrl: 'http://evil.example.com', printer: { mode: 'ROOTKIT' } }));
    const c = createConfigStore({ dir: tmp, fs }).get();
    expect(c.backendUrl).toBe('');
    expect(c.printer.mode).toBe('NONE');
  });
  it('uses an operator default only when the user has not chosen a server', () => {
    const s = createConfigStore({ dir: tmp, fs, defaults: { backendUrl: 'https://fleet.example.com' } });
    expect(s.get().backendUrl).toBe('https://fleet.example.com');
    s.setBackendUrl('https://mine.example.com');
    expect(createConfigStore({ dir: tmp, fs, defaults: { backendUrl: 'https://fleet.example.com' } }).get().backendUrl).toBe('https://mine.example.com');
  });
  it('validates printer settings', () => {
    expect(validatePrinterConfig({ mode: 'ESCPOS_NETWORK', host: '192.168.1.50', port: 9100 }).ok).toBe(true);
    expect(validatePrinterConfig({ mode: 'ESCPOS_NETWORK', host: 'printer1', port: 9100 }).ok).toBe(true);
    expect(validatePrinterConfig({ mode: 'ESCPOS_NETWORK', host: 'evil.example.com', port: 9100 }).ok).toBe(false);
    expect(validatePrinterConfig({ mode: 'ESCPOS_NETWORK', host: '8.8.8.8', port: 9100 }).ok).toBe(false);
    expect(validatePrinterConfig({ mode: 'ESCPOS_NETWORK', host: '', port: 9100 }).ok).toBe(false);
    expect(validatePrinterConfig({ mode: 'ESCPOS_NETWORK', host: '192.168.1.5', port: 70000 }).ok).toBe(false);
    expect(validatePrinterConfig({ mode: 'OTHER' }).ok).toBe(false);
    expect(validatePrinterConfig(null).ok).toBe(false);
    expect(validatePrinterConfig({ mode: 'NONE', openDrawerOnCash: true }).value.openDrawerOnCash).toBe(true);
  });
});

describe('secure store', () => {
  const fakeSafe = (available = true) => ({
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString('hex')}`),
    decryptString: (b) => {
      const t = b.toString();
      if (!t.startsWith('enc:')) throw new Error('bad');
      return Buffer.from(t.slice(4), 'hex').toString();
    },
  });

  it('stores only encrypted data on disk and round-trips', () => {
    const s = createSecureStore({ safeStorage: fakeSafe(), fs, dir: tmp });
    s.set('auth.token', 'super-secret-jwt');
    expect(fs.readFileSync(path.join(tmp, 'secure.json'), 'utf8')).not.toContain('super-secret-jwt');
    expect(s.get('auth.token')).toBe('super-secret-jwt');
    s.delete('auth.token');
    expect(s.get('auth.token')).toBeNull();
  });
  it('refuses unknown keys (not a general file store)', () => {
    const s = createSecureStore({ safeStorage: fakeSafe(), fs, dir: tmp });
    expect(() => s.set('anything', 'x')).toThrow('Unknown secure storage key.');
    expect(() => s.get('../../etc/passwd')).toThrow();
  });
  it('never falls back to plaintext when encryption is unavailable', () => {
    const s = createSecureStore({ safeStorage: fakeSafe(false), fs, dir: tmp });
    expect(() => s.set('auth.token', 'x')).toThrow(/not available/);
    expect(fs.existsSync(path.join(tmp, 'secure.json'))).toBe(false);
    expect(s.get('auth.token')).toBeNull();
  });
  it('rejects empty, non-string and oversized values', () => {
    const s = createSecureStore({ safeStorage: fakeSafe(), fs, dir: tmp });
    expect(() => s.set('auth.token', '')).toThrow();
    expect(() => s.set('auth.token', 123)).toThrow();
    expect(() => s.set('auth.token', 'x'.repeat(9000))).toThrow(/too large/);
  });
  it('forgets a corrupt entry instead of throwing', () => {
    const s = createSecureStore({ safeStorage: fakeSafe(), fs, dir: tmp });
    fs.writeFileSync(path.join(tmp, 'secure.json'), JSON.stringify({ 'auth.token': Buffer.from('garbage').toString('base64') }));
    expect(s.get('auth.token')).toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'secure.json'), 'utf8'))).toEqual({});
  });
});

describe('static file resolution (path traversal and SPA fallback)', () => {
  const root = path.resolve('/app/dist');
  const files = new Set([path.join(root, 'index.html'), path.join(root, 'assets', 'a.js'), path.join(root, 'secret', '.env')]);
  const isFile = (p) => files.has(p);

  it('serves real files', () => {
    expect(resolveStatic(root, '/assets/a.js', isFile)).toEqual({ kind: 'file', file: path.join(root, 'assets', 'a.js') });
  });
  it('falls back to index.html for client-side routes (BrowserRouter)', () => {
    for (const p of ['/', '/login', '/cash-register', '/inventory/42']) {
      expect(resolveStatic(root, p, isFile)).toEqual({ kind: 'spa', file: path.join(root, 'index.html') });
    }
  });
  it('returns a real 404 for missing assets rather than index.html', () => {
    expect(resolveStatic(root, '/assets/missing.js', isFile)).toEqual({ kind: 'notfound' });
  });
  it('blocks traversal in every encoding', () => {
    for (const p of ['/../etc/passwd', '/assets/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc/passwd', '/assets/..\\..\\x', '/a%00b', '/%E0%A4%A']) {
      expect(resolveStatic(root, p, isFile).kind).toBe('forbidden');
    }
  });
  it('blocks dotfiles', () => {
    expect(resolveStatic(root, '/secret/.env', isFile).kind).toBe('forbidden');
    expect(resolveStatic(root, '/.git/config', isFile).kind).toBe('forbidden');
  });
});

describe('API proxy helpers', () => {
  it('maps /api/* onto the configured backend origin', () => {
    expect(buildProxyTarget('https://pos.example.com', 'numzpos://app/api/sales?x=1')).toEqual({ ok: true, target: 'https://pos.example.com/api/sales?x=1' });
  });
  it('refuses when no server is configured', () => {
    expect(buildProxyTarget('', 'numzpos://app/api/sales')).toMatchObject({ ok: false, status: 503 });
  });
  it('refuses paths outside /api, including dot-segment tricks', () => {
    for (const u of ['numzpos://app/other', 'numzpos://app/apix/sales', 'numzpos://app/api/../admin', 'numzpos://app/%2e%2e/api/sales']) {
      const r = buildProxyTarget('https://pos.example.com', u);
      if (r.ok) expect(new URL(r.target).pathname.startsWith('/api')).toBe(true);
      else expect(r.ok).toBe(false);
    }
    expect(buildProxyTarget('https://pos.example.com', 'numzpos://app/api/../admin').ok).toBe(false);
  });
  it('forwards only allowlisted request headers (never cookies or origin)', () => {
    const out = filterRequestHeaders([
      ['Authorization', 'Bearer abc'],
      ['Content-Type', 'application/json'],
      ['Cookie', 'sid=1'],
      ['Origin', 'numzpos://app'],
      ['Host', 'x'],
      ['X-Request-Id', '1'],
    ]);
    expect(out).toEqual({ authorization: 'Bearer abc', 'content-type': 'application/json', 'x-request-id': '1' });
  });
});

describe('CSP and navigation guard', () => {
  it('production CSP has no inline/eval scripts and no remote connections', () => {
    const csp = buildCsp();
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/https?:\/\//);
  });
  it('dev CSP additionally allows only the dev server', () => {
    const csp = buildCsp({ dev: true, devOrigin: 'http://localhost:5173' });
    expect(csp).toContain('http://localhost:5173');
    expect(csp).toContain('ws://localhost:5173');
  });
  it('allows in-window navigation only inside our origin', () => {
    const allowed = ['numzpos://app'];
    expect(isAllowedNavigation('numzpos://app/login', allowed)).toBe(true);
    expect(isAllowedNavigation('https://evil.example/', allowed)).toBe(false);
    expect(isAllowedNavigation('file:///C:/Windows/System32', allowed)).toBe(false);
    expect(isAllowedNavigation('javascript:alert(1)', allowed)).toBe(false);
  });
  it('opens only plain https links externally', () => {
    expect(isSafeExternalUrl('https://numz.example/help')).toBe(true);
    for (const u of ['http://x.com', 'file:///x', 'javascript:1', 'smb://host/share', 'https://u:p@x.com', 'garbage']) {
      expect(isSafeExternalUrl(u)).toBe(false);
    }
  });
});

describe('ESC/POS printing', () => {
  it('sends bytes to a real TCP listener and reports success', async () => {
    const received = [];
    const server = net.createServer((sock) => sock.on('data', (d) => received.push(d)));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    await sendRaw({ host: '127.0.0.1', port, data: Uint8Array.from([1, 2, 3]) });
    await new Promise((r) => setTimeout(r, 50));
    server.close();
    expect(Buffer.concat(received)).toEqual(Buffer.from([1, 2, 3]));
  });
  it('rejects with a readable message when the printer is unreachable', async () => {
    const probe = net.createServer();
    await new Promise((r) => probe.listen(0, '127.0.0.1', r));
    const { port } = probe.address();
    await new Promise((r) => probe.close(r));
    await expect(sendRaw({ host: '127.0.0.1', port, data: Uint8Array.from([1]), timeoutMs: 1000 })).rejects.toThrow(/Printer error: ECONNREFUSED/);
  });
  it('strips the drawer pulse unless explicitly enabled', () => {
    const body = [0x41, 0x42];
    const withKick = Uint8Array.from([0x1b, 0x40, ...DRAWER_KICK, ...body]);
    expect([...applyDrawerPolicy(withKick, false)]).toEqual([0x1b, 0x40, ...body]);
    expect(applyDrawerPolicy(withKick, true)).toBe(withKick);
  });
  it('leaves non-matching byte layouts untouched', () => {
    const odd = Uint8Array.from([0x1b, 0x40, 0x41, 0x42]);
    expect(applyDrawerPolicy(odd, false)).toBe(odd);
  });
  it('builds a test page ending in a cut command', () => {
    const p = buildTestPage(new Date('2026-01-01T00:00:00Z'));
    expect([...p.slice(-3)]).toEqual([0x1d, 0x56, 0x00]);
    expect(Buffer.from(p).toString()).toContain('Printer test OK');
  });
  it('validates receipt payload shape', () => {
    expect(looksLikeReceiptViewModel(null)).toBe(false);
    expect(looksLikeReceiptViewModel({ merchant: {} })).toBe(false);
    expect(looksLikeReceiptViewModel('x')).toBe(false);
  });
});

describe('print service', () => {
  const vm = {
    merchant: { tradingName: 'T' }, transaction: {}, items: [], totals: {},
    payment: { method: 'CASH' }, fiscal: {}, footer: {}, receiptMeta: {},
  };
  const cfg = (printer) => () => ({ backendUrl: '', printer: { mode: 'NONE', systemPrinterName: '', host: '', port: 9100, openDrawerOnCash: false, ...printer } });
  const engine = { buildEscPosCommands: () => Uint8Array.from([0x1b, 0x40, ...DRAWER_KICK, 0x41]) };

  it('asks the renderer to print the page when no ESC/POS printer is configured', async () => {
    const svc = createPrintService({ getConfig: cfg({}), engine, sendRaw: vi.fn() });
    expect(await svc.printReceipt(vm)).toEqual({ ok: true, method: 'page' });
  });
  it('sends ESC/POS bytes without a drawer pulse by default', async () => {
    const sendRawMock = vi.fn(async () => true);
    const svc = createPrintService({ getConfig: cfg({ mode: 'ESCPOS_NETWORK', host: '192.168.1.5' }), engine, sendRaw: sendRawMock });
    expect(await svc.printReceipt(vm)).toEqual({ ok: true, method: 'escpos' });
    expect([...sendRawMock.mock.calls[0][0].data]).toEqual([0x1b, 0x40, 0x41]);
  });
  it('keeps the drawer pulse when the operator enabled it', async () => {
    const sendRawMock = vi.fn(async () => true);
    const svc = createPrintService({ getConfig: cfg({ mode: 'ESCPOS_NETWORK', host: '192.168.1.5', openDrawerOnCash: true }), engine, sendRaw: sendRawMock });
    await svc.printReceipt(vm);
    expect(sendRawMock.mock.calls[0][0].data.length).toBe(2 + DRAWER_KICK.length + 1);
  });
  it('reports printer failures as an error result, never throws', async () => {
    const svc = createPrintService({ getConfig: cfg({ mode: 'ESCPOS_NETWORK', host: '192.168.1.5' }), engine, sendRaw: async () => { throw new Error('Printer error: ECONNREFUSED'); } });
    expect(await svc.printReceipt(vm)).toEqual({ ok: false, error: 'Printer error: ECONNREFUSED' });
  });
  it('rejects a malformed receipt payload before touching the network', async () => {
    const sendRawMock = vi.fn();
    const svc = createPrintService({ getConfig: cfg({ mode: 'ESCPOS_NETWORK', host: '192.168.1.5' }), engine, sendRaw: sendRawMock });
    expect((await svc.printReceipt({ bogus: true })).ok).toBe(false);
    expect(sendRawMock).not.toHaveBeenCalled();
  });
  it('does not pretend a driver printer can open a cash drawer', async () => {
    const svc = createPrintService({ getConfig: cfg({ mode: 'SYSTEM', systemPrinterName: 'EPSON' }), engine, sendRaw: vi.fn() });
    const r = await svc.openDrawer();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/network ESC\/POS/);
  });
  it('pulses the drawer through a network printer', async () => {
    const sendRawMock = vi.fn(async () => true);
    const svc = createPrintService({ getConfig: cfg({ mode: 'ESCPOS_NETWORK', host: '192.168.1.5' }), engine, sendRaw: sendRawMock });
    expect(await svc.openDrawer()).toEqual({ ok: true });
    expect(sendRawMock.mock.calls[0][0].data).toBe(DRAWER_KICK);
  });
  it('prints the current page silently only when a Windows printer is named', async () => {
    const printCalls = [];
    const wc = { print: (opts, cb) => { printCalls.push(opts); cb(true, ''); } };
    const named = createPrintService({ getConfig: cfg({ mode: 'SYSTEM', systemPrinterName: 'EPSON TM' }), engine });
    expect(await named.printCurrentPage(wc)).toEqual({ ok: true, method: 'system-silent' });
    expect(printCalls[0]).toMatchObject({ silent: true, deviceName: 'EPSON TM' });
    const unnamed = createPrintService({ getConfig: cfg({}), engine });
    expect(await unnamed.printCurrentPage(wc)).toEqual({ ok: true, method: 'system-dialog' });
    expect(printCalls[1].silent).toBe(false);
  });
  it('surfaces a failed page print', async () => {
    const svc = createPrintService({ getConfig: cfg({}), engine });
    const r = await svc.printCurrentPage({ print: (_o, cb) => cb(false, 'cancelled') });
    expect(r).toEqual({ ok: false, error: 'cancelled' });
  });
});

describe('updater', () => {
  const fakeUpdater = () => {
    const handlers = {};
    return {
      on: (e, fn) => (handlers[e] = fn),
      emit: (e, p) => handlers[e] && handlers[e](p),
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(async () => {}),
      downloadUpdate: vi.fn(async () => {}),
      quitAndInstall: vi.fn(),
    };
  };
  it('is disabled with no feed, in development, or with a non-https feed', () => {
    expect(createUpdater({ autoUpdater: fakeUpdater(), feedUrl: '', isPackaged: true }).getStatus().state).toBe('disabled');
    expect(createUpdater({ autoUpdater: fakeUpdater(), feedUrl: 'https://u.example.com', isPackaged: false }).getStatus().state).toBe('disabled');
    const insecure = createUpdater({ autoUpdater: fakeUpdater(), feedUrl: 'http://u.example.com', isPackaged: true });
    expect(insecure.enabled).toBe(false);
    expect(insecure.getStatus().reason).toMatch(/https/);
  });
  it('never auto-downloads or auto-installs, and does not allow downgrades', () => {
    const au = fakeUpdater();
    createUpdater({ autoUpdater: au, feedUrl: 'https://u.example.com/feed', isPackaged: true });
    expect(au.autoDownload).toBe(false);
    expect(au.autoInstallOnAppQuit).toBe(false);
    expect(au.allowDowngrade).toBe(false);
    expect(au.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'https://u.example.com/feed' });
  });
  it('walks check -> available -> download -> downloaded -> install, pushing status', async () => {
    const au = fakeUpdater();
    const seen = [];
    const u = createUpdater({ autoUpdater: au, feedUrl: 'https://u.example.com/feed', isPackaged: true, onStatus: (s) => seen.push(s.state) });
    await u.check();
    au.emit('update-available', { version: '1.1.0' });
    expect(u.getStatus()).toMatchObject({ state: 'available', version: '1.1.0' });
    await u.download();
    au.emit('download-progress', { percent: 42.4 });
    expect(u.getStatus()).toMatchObject({ state: 'downloading', percent: 42 });
    au.emit('update-downloaded', { version: '1.1.0' });
    expect(u.install()).toEqual({ ok: true });
    expect(au.quitAndInstall).toHaveBeenCalled();
    expect(seen).toContain('downloaded');
  });
  it('refuses to download or install out of order', async () => {
    const au = fakeUpdater();
    const u = createUpdater({ autoUpdater: au, feedUrl: 'https://u.example.com/feed', isPackaged: true });
    expect((await u.download()).ok).toBe(false);
    expect(u.install().ok).toBe(false);
    expect(au.downloadUpdate).not.toHaveBeenCalled();
    expect(au.quitAndInstall).not.toHaveBeenCalled();
  });
  it('turns update errors into a visible error state', async () => {
    const au = fakeUpdater();
    au.checkForUpdates = async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED'); };
    const u = createUpdater({ autoUpdater: au, feedUrl: 'https://u.example.com/feed', isPackaged: true });
    const r = await u.check();
    expect(r.ok).toBe(false);
    expect(u.getStatus().state).toBe('error');
  });
});

describe('logger and diagnostics', () => {
  it('masks bearer tokens and JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.abcdefghijk';
    expect(redact(`Authorization: Bearer ${jwt}`)).not.toContain('eyJ');
    expect(redact(`token=${jwt}`)).toContain('[jwt-redacted]');
  });
  it('writes to a file and rotates past the size cap', () => {
    const out = { log: vi.fn(), error: vi.fn() };
    const log = createLogger({ dir: tmp, fs, console: out });
    log.info('hello');
    expect(fs.readFileSync(log.file, 'utf8')).toContain('INFO hello');
    fs.writeFileSync(log.file, 'x'.repeat(2 * 1024 * 1024 + 10));
    log.info('after');
    expect(fs.existsSync(`${log.file}.1`)).toBe(true);
  });
  it('reports backend reachability without leaking anything sensitive', async () => {
    const ok = await checkBackend('https://pos.example.com', async () => ({ ok: true, status: 200 }));
    expect(ok).toMatchObject({ configured: true, reachable: true, status: 200 });
    const down = await checkBackend('https://pos.example.com', async () => { throw new Error('ECONNREFUSED 10.1.1.1'); });
    expect(down).toEqual({ configured: true, reachable: false, error: 'Unreachable' });
    expect(await checkBackend('', async () => ({}))).toEqual({ configured: false, reachable: false });
  });
});
