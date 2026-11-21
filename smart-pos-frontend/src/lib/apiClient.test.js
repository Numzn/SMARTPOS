import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiFetch, ApiError, NetworkError } from './apiClient';
import { getConnectivity, __resetConnectivityForTests } from './connectivity';

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  json: async () => body,
});

beforeEach(() => {
  __resetConnectivityForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  __resetConnectivityForTests();
});

describe('apiFetch error kinds', () => {
  it('a rejected fetch becomes a NetworkError with kind "network" and NO .response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await apiFetch('/x').catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.kind).toBe('network');
    expect(err.response).toBeUndefined(); // existing `!error.response` checks keep working
    expect(err.message).toMatch(/Cannot reach the server/);
  });

  it('401 is kind "auth"; ordinary 4xx/5xx are "business"; 502/504 are "network"', async () => {
    const kind = async (status) => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonRes(status, { error: 'nope' })));
      const e = await apiFetch('/not-login').catch((x) => x);
      expect(e).toBeInstanceOf(ApiError);
      return e.kind;
    };
    // handleUnauthorized hard-redirects on 401; neutralise it for the test
    const loc = window.location;
    delete window.location;
    window.location = { pathname: '/login', href: '' };
    expect(await kind(401)).toBe('auth');
    window.location = loc;
    expect(await kind(400)).toBe('business');
    expect(await kind(409)).toBe('business');
    expect(await kind(422)).toBe('business');
    expect(await kind(500)).toBe('business');
    // our own routes answer 503 for business conditions (e.g. VSDC not initialised)
    expect(await kind(503)).toBe('business');
    expect(await kind(502)).toBe('network');
    expect(await kind(504)).toBe('network');
  });

  it('a timeout becomes a NetworkError too', async () => {
    vi.stubGlobal('fetch', vi.fn((_u, init) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(init.signal.reason));
    })));
    const err = await apiFetch('/slow', { timeoutMs: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
  });

  it('does not forward the private timeoutMs option to fetch', async () => {
    const f = vi.fn(async () => jsonRes(200, {}));
    vi.stubGlobal('fetch', f);
    await apiFetch('/x', { timeoutMs: 5000, method: 'POST' });
    const init = f.mock.calls[0][1];
    expect('timeoutMs' in init).toBe(false);
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('feeds the connectivity signal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(200, {})));
    await apiFetch('/ok');
    expect(getConnectivity().status).toBe('ONLINE');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('x'); }));
    await apiFetch('/bad').catch(() => {});
    expect(getConnectivity().status).toBe('DEGRADED');
    await apiFetch('/bad').catch(() => {});
    expect(getConnectivity().status).toBe('OFFLINE');
  });

  it('success path is unchanged: returns parsed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(200, { hello: 'world' })));
    expect(await apiFetch('/ok')).toEqual({ hello: 'world' });
  });
});
