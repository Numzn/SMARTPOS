import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createAppProtocolHandler, PRIVILEGED_SCHEME } = require('../services/appProtocol');

const dist = path.resolve('/bundle/app-dist');
const pages = path.resolve('/bundle/renderer');
const store = new Map([
  [path.join(dist, 'index.html'), '<html>app</html>'],
  [path.join(dist, 'assets', 'index-abc.js'), 'console.log(1)'],
  [path.join(dist, 'assets', 'style.css'), 'body{}'],
  [path.join(pages, 'setup.html'), '<html>setup</html>'],
]);
const fakeFs = {
  statSync: (p) => {
    if (!store.has(p)) throw new Error('ENOENT');
    return { isFile: () => true };
  },
  promises: { readFile: async (p) => Buffer.from(store.get(p)) },
};

function make({ backend = 'https://pos.example.com', fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 })) } = {}) {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const handler = createAppProtocolHandler({
    appDistDir: dist,
    desktopPagesDir: pages,
    fs: fakeFs,
    getBackendOrigin: () => backend,
    fetchImpl,
    csp: "default-src 'self'",
    log,
  });
  return { handler, fetchImpl, log };
}
const req = (url, init) => new Request(url, init);

describe('numzpos:// protocol handler', () => {
  it('serves index.html for the app root and client-side routes, always revalidated', async () => {
    const { handler } = make();
    for (const u of ['numzpos://app/', 'numzpos://app/login', 'numzpos://app/cash-register']) {
      const res = await handler(req(u));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('<html>app</html>');
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('cache-control')).toBe('no-cache');
    }
  });

  it('serves hashed assets with the right type and immutable caching', async () => {
    const { handler } = make();
    const js = await handler(req('numzpos://app/assets/index-abc.js'));
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect(js.headers.get('cache-control')).toContain('immutable');
    const css = await handler(req('numzpos://app/assets/style.css'));
    expect(css.headers.get('content-type')).toContain('text/css');
  });

  it('puts CSP and nosniff on every response', async () => {
    const { handler } = make();
    const res = await handler(req('numzpos://app/'));
    expect(res.headers.get('content-security-policy')).toBe("default-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('404s a missing asset', async () => {
    const { handler } = make();
    expect((await handler(req('numzpos://app/assets/nope.js'))).status).toBe(404);
  });

  it('never serves anything outside the bundle, however the traversal is encoded', async () => {
    const { handler } = make();
    // The URL parser collapses literal and %2e-encoded dot segments before the
    // handler runs, so these resolve to ordinary in-bundle paths (the SPA shell).
    for (const u of ['numzpos://app/%2e%2e/%2e%2e/etc/passwd', 'numzpos://app/assets/../../etc/passwd']) {
      const res = await handler(req(u));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('<html>app</html>');
    }
    // Encoded slashes survive URL parsing, so the resolver must refuse them itself.
    for (const u of ['numzpos://app/..%2f..%2fetc/passwd', 'numzpos://app/assets%2f..%2f..%2fx', 'numzpos://app/a%00b', 'numzpos://app/.env']) {
      expect((await handler(req(u))).status).toBe(403);
    }
  });

  it('serves the bundled setup page only from the desktop pages dir', async () => {
    const { handler } = make();
    const ok = await handler(req('numzpos://app/__desktop/setup.html'));
    expect(await ok.text()).toBe('<html>setup</html>');
    // "/__desktop/../index.html" collapses to the app's own /index.html, never the pages dir.
    const escaped = await handler(req('numzpos://app/__desktop/../index.html'));
    expect(await escaped.text()).toBe('<html>app</html>');
    expect((await handler(req('numzpos://app/__desktop/..%2fsetup.html'))).status).toBe(403);
    expect((await handler(req('numzpos://app/__desktop/nope.html'))).status).toBe(404);
  });

  it('rejects non-GET requests to static paths', async () => {
    const { handler } = make();
    expect((await handler(req('numzpos://app/login', { method: 'POST', body: 'x' }))).status).toBe(405);
  });

  it('ignores other hosts on the scheme', async () => {
    const { handler } = make();
    expect((await handler(req('numzpos://evil/'))).status).toBe(404);
  });

  describe('API proxy', () => {
    it('forwards /api/* to the configured backend with allowlisted headers only', async () => {
      const { handler, fetchImpl } = make();
      const res = await handler(
        req('numzpos://app/api/sales?x=1', {
          method: 'POST',
          headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', Cookie: 'a=b' },
          body: '{"a":1}',
        })
      );
      expect(res.status).toBe(200);
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://pos.example.com/api/sales?x=1');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ authorization: 'Bearer t', 'content-type': 'application/json' });
      expect(init.redirect).toBe('manual');
      expect(init.bypassCustomProtocolHandlers).toBe(true);
    });

    it('returns 503 with a clear message when no server is configured', async () => {
      const { handler, fetchImpl } = make({ backend: '' });
      const res = await handler(req('numzpos://app/api/health'));
      expect(res.status).toBe(503);
      expect(await res.text()).toMatch(/No server is configured/);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('lets network failures reject so the renderer fetch() fails like a browser would', async () => {
      const { handler } = make({ fetchImpl: vi.fn(async () => { throw new TypeError('fetch failed'); }) });
      await expect(handler(req('numzpos://app/api/health'))).rejects.toThrow('fetch failed');
    });

    it('passes backend error statuses through untouched', async () => {
      const { handler } = make({ fetchImpl: vi.fn(async () => new Response('{"error":"nope"}', { status: 409 })) });
      const res = await handler(req('numzpos://app/api/sales/checkout', { method: 'POST', body: '{}' }));
      expect(res.status).toBe(409);
    });
  });
});

describe('scheme registration', () => {
  it('is standard + secure but does not bypass CSP, enable CORS or service workers', () => {
    expect(PRIVILEGED_SCHEME.scheme).toBe('numzpos');
    expect(PRIVILEGED_SCHEME.privileges.standard).toBe(true);
    expect(PRIVILEGED_SCHEME.privileges.secure).toBe(true);
    expect(PRIVILEGED_SCHEME.privileges.bypassCSP).toBeUndefined();
    expect(PRIVILEGED_SCHEME.privileges.corsEnabled).toBeUndefined();
    expect(PRIVILEGED_SCHEME.privileges.allowServiceWorkers).toBeUndefined();
  });
});
