import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Cookies from 'js-cookie';
import {
  hydrateTokenStore,
  getInitialToken,
  getRequestToken,
  saveToken,
  clearToken,
  __resetTokenStoreForTests,
} from './tokenStore';

function installBridge(overrides = {}) {
  const secureStore = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => true),
    delete: vi.fn(async () => true),
    ...overrides,
  };
  window.numzDesktop = { isDesktop: true, secureStore };
  return secureStore;
}

beforeEach(() => {
  __resetTokenStoreForTests();
  Cookies.remove('token');
  localStorage.clear();
});
afterEach(() => {
  delete window.numzDesktop;
});

describe('tokenStore in a browser (existing behaviour must not change)', () => {
  it('saves to cookie and localStorage, and reads them back', () => {
    saveToken('web-token');
    expect(Cookies.get('token')).toBe('web-token');
    expect(localStorage.getItem('token')).toBe('web-token');
    expect(getInitialToken()).toBe('web-token');
    expect(getRequestToken()).toBe('web-token');
  });

  it('initial state reads the cookie only, requests fall back to localStorage', () => {
    localStorage.setItem('token', 'ls-only');
    expect(getInitialToken()).toBeUndefined();
    expect(getRequestToken()).toBe('ls-only');
  });

  it('clearToken removes both copies', () => {
    saveToken('x');
    clearToken();
    expect(Cookies.get('token')).toBeUndefined();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('hydrate is a harmless no-op without the desktop bridge', async () => {
    await expect(hydrateTokenStore()).resolves.toBeUndefined();
  });
});

describe('tokenStore in the desktop app', () => {
  it('never writes the token to cookies or localStorage', async () => {
    const secure = installBridge();
    saveToken('desktop-token');
    expect(Cookies.get('token')).toBeUndefined();
    expect(localStorage.getItem('token')).toBeNull();
    expect(secure.set).toHaveBeenCalledWith('auth.token', 'desktop-token');
    expect(getInitialToken()).toBe('desktop-token');
    expect(getRequestToken()).toBe('desktop-token');
  });

  it('restores the saved token from secure storage on startup', async () => {
    installBridge({ get: vi.fn(async () => 'saved-token') });
    await hydrateTokenStore();
    expect(getInitialToken()).toBe('saved-token');
  });

  it('treats a secure-store failure as "signed out", not a crash', async () => {
    installBridge({ get: vi.fn(async () => { throw new Error('no keychain'); }) });
    await hydrateTokenStore();
    expect(getInitialToken()).toBeUndefined();
  });

  it('keeps the session in memory when persisting fails', () => {
    installBridge({ set: vi.fn(async () => { throw new Error('Secure storage is not available'); }) });
    saveToken('mem-only');
    expect(getRequestToken()).toBe('mem-only');
  });

  it('clearToken wipes memory and the secure store', () => {
    const secure = installBridge();
    saveToken('x');
    clearToken();
    expect(getRequestToken()).toBeUndefined();
    expect(secure.delete).toHaveBeenCalledWith('auth.token');
  });
});
