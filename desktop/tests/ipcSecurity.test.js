import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { isTrustedFrame, isTrustedSender, originOf } = require('../ipc/senderValidation');
const { INVOKE_CHANNELS } = require('../ipc/channels');
const { registerIpc } = require('../ipc/register');

const TRUSTED = ['numzpos://app'];

function fakeIpcMain() {
  const handlers = new Map();
  return { handlers, handle: (ch, fn) => handlers.set(ch, fn) };
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function fakeServices(overrides = {}) {
  return {
    app: { info: () => ({ version: '1.0.0' }) },
    config: {
      get: () => ({ backendUrl: 'https://pos.example.com', printer: { mode: 'NONE' } }),
      setBackendUrl: vi.fn(() => ({ ok: true })),
      setPrinter: vi.fn(() => ({ ok: true })),
    },
    secureStore: { get: vi.fn(() => 'tok'), set: vi.fn(() => true), delete: vi.fn(() => true) },
    printing: {
      listPrinters: vi.fn(async () => ({ ok: true, printers: [] })),
      printCurrentPage: vi.fn(async () => ({ ok: true })),
      printReceipt: vi.fn(async () => ({ ok: true })),
      testPrinter: vi.fn(async () => ({ ok: true })),
      openDrawer: vi.fn(async () => ({ ok: true })),
    },
    updater: { getStatus: () => ({ state: 'disabled' }), check: vi.fn(), download: vi.fn(), install: vi.fn() },
    diagnostics: async () => ({}),
    ...overrides,
  };
}

function event(url, parent = null) {
  return { senderFrame: { url, parent }, sender: {} };
}

describe('sender validation', () => {
  it('computes origins for custom schemes (URL.origin is "null" for them)', () => {
    expect(originOf('numzpos://app/login')).toBe('numzpos://app');
    expect(originOf('https://evil.example/x')).toBe('https://evil.example');
    expect(originOf('not a url')).toBeNull();
  });

  it('trusts only the main frame of our own origin', () => {
    expect(isTrustedFrame({ url: 'numzpos://app/', isMainFrame: true }, TRUSTED)).toBe(true);
    expect(isTrustedFrame({ url: 'numzpos://app/', isMainFrame: false }, TRUSTED)).toBe(false);
    expect(isTrustedFrame({ url: 'https://evil.example/', isMainFrame: true }, TRUSTED)).toBe(false);
    expect(isTrustedFrame({ url: 'numzpos://other/', isMainFrame: true }, TRUSTED)).toBe(false);
    expect(isTrustedFrame({ url: 'file:///etc/passwd', isMainFrame: true }, TRUSTED)).toBe(false);
  });

  it('rejects events with no sender frame (destroyed frame)', () => {
    expect(isTrustedSender({}, TRUSTED)).toBe(false);
    expect(isTrustedSender({ senderFrame: null }, TRUSTED)).toBe(false);
  });

  it('treats a sub-frame (parent set) as untrusted', () => {
    expect(isTrustedSender(event('numzpos://app/', {}), TRUSTED)).toBe(false);
  });
});

describe('registerIpc', () => {
  function setup(services = fakeServices()) {
    const ipcMain = fakeIpcMain();
    const registered = registerIpc({
      ipcMain,
      trustedOrigins: TRUSTED,
      services,
      onOpenSetup: vi.fn(),
      fetchImpl: vi.fn(),
      log,
    });
    return { ipcMain, registered, services };
  }

  it('registers exactly the allowlisted channels, no more and no fewer', () => {
    const { ipcMain, registered } = setup();
    expect([...ipcMain.handlers.keys()].sort()).toEqual([...INVOKE_CHANNELS].sort());
    expect(registered.sort()).toEqual([...INVOKE_CHANNELS].sort());
  });

  it('rejects EVERY channel from an untrusted origin without running the handler', async () => {
    const { ipcMain, services } = setup();
    for (const channel of INVOKE_CHANNELS) {
      await expect(ipcMain.handlers.get(channel)(event('https://evil.example/'), 'auth.token', 'x')).rejects.toThrow(
        'Untrusted sender.'
      );
    }
    expect(services.secureStore.get).not.toHaveBeenCalled();
    expect(services.secureStore.set).not.toHaveBeenCalled();
    expect(services.printing.printReceipt).not.toHaveBeenCalled();
    expect(services.config.setBackendUrl).not.toHaveBeenCalled();
  });

  it('rejects calls from a sub-frame even on our own origin', async () => {
    const { ipcMain, services } = setup();
    await expect(ipcMain.handlers.get('secureStore:get')(event('numzpos://app/', {}), 'auth.token')).rejects.toThrow(
      'Untrusted sender.'
    );
    expect(services.secureStore.get).not.toHaveBeenCalled();
  });

  it('runs the handler for a trusted sender', async () => {
    const { ipcMain, services } = setup();
    const out = await ipcMain.handlers.get('secureStore:get')(event('numzpos://app/dashboard'), 'auth.token');
    expect(out).toBe('tok');
    expect(services.secureStore.get).toHaveBeenCalledWith('auth.token');
  });

  it('surfaces handler errors as plain messages (no stack, no internals)', async () => {
    const services = fakeServices({
      secureStore: {
        get: () => {
          throw new Error('Unknown secure storage key.');
        },
        set: vi.fn(),
        delete: vi.fn(),
      },
    });
    const { ipcMain } = setup(services);
    const err = await ipcMain.handlers.get('secureStore:get')(event('numzpos://app/'), 'evil').catch((e) => e);
    expect(err.message).toBe('Unknown secure storage key.');
  });

  it('refuses to register a channel that is not in the allowlist', () => {
    // Guard against someone adding a handle() call without updating channels.js.
    const src = require('fs').readFileSync(require.resolve('../ipc/register.js'), 'utf8');
    const used = [...src.matchAll(/handle\('([^']+)'/g)].map((m) => m[1]);
    for (const ch of used) expect(INVOKE_CHANNELS).toContain(ch);
    expect(used.sort()).toEqual([...INVOKE_CHANNELS].sort());
  });
});
