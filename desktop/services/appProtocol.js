'use strict';

const path = require('path');
const { APP_SCHEME, APP_HOST, DESKTOP_PAGES_PREFIX, API_TIMEOUT_MS } = require('../config/constants');
const { resolveStatic, mimeFor } = require('./staticResolver');
const { buildProxyTarget, filterRequestHeaders } = require('./backendProxy');

/**
 * Serves the bundled React build from numzpos://app/ and proxies /api/* to the
 * configured backend. All Electron objects are injected so this file can be
 * tested with fakes.
 *
 *   numzpos://app/__desktop/*  -> desktop/renderer (server-setup page)
 *   numzpos://app/api/*        -> <configured backend>/api/*
 *   numzpos://app/*            -> bundled frontend build, SPA fallback to index.html
 */
function createAppProtocolHandler({ appDistDir, desktopPagesDir, fs, getBackendOrigin, fetchImpl, csp, log }) {
  const isFile = (p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };

  const securityHeaders = (extra) => ({
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  });

  function plain(status, message) {
    return new Response(message, {
      status,
      headers: securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }),
    });
  }

  async function serveFile(file, isIndex) {
    const body = await fs.promises.readFile(file);
    return new Response(body, {
      status: 200,
      headers: securityHeaders({
        'Content-Type': mimeFor(file),
        // index.html must always be revalidated; hashed assets are immutable.
        'Cache-Control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
      }),
    });
  }

  async function proxy(request) {
    const origin = getBackendOrigin();
    const t = buildProxyTarget(origin, request.url);
    if (!t.ok) return plain(t.status, t.error);

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    // A network failure (offline, DNS, refused) is allowed to reject, so the
    // renderer's fetch() throws exactly as it does in a browser and the
    // existing "cannot reach the server" handling keeps working.
    return fetchImpl(t.target, {
      method: request.method,
      headers: filterRequestHeaders(request.headers.entries()),
      body: hasBody ? request.body : undefined,
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      bypassCustomProtocolHandlers: true,
    });
  }

  return async function handler(request) {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return plain(400, 'Bad request');
    }
    if (url.host !== APP_HOST) return plain(404, 'Not found');

    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await proxy(request);

      if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'Method not allowed');

      if (url.pathname.startsWith(DESKTOP_PAGES_PREFIX)) {
        const sub = url.pathname.slice(DESKTOP_PAGES_PREFIX.length - 1); // keep leading "/"
        const r = resolveStatic(desktopPagesDir, sub, isFile);
        if (r.kind === 'file') return await serveFile(r.file, true);
        return plain(r.kind === 'forbidden' ? 403 : 404, 'Not found');
      }

      const r = resolveStatic(appDistDir, url.pathname, isFile);
      if (r.kind === 'file') return await serveFile(r.file, path.basename(r.file) === 'index.html');
      if (r.kind === 'spa') return await serveFile(r.file, true);
      return plain(r.kind === 'forbidden' ? 403 : 404, 'Not found');
    } catch (e) {
      // Proxy network errors must propagate (see proxy()); everything else is a 500.
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        log.warn(`API proxy error: ${e && e.name}`);
        throw e;
      }
      log.error(`Protocol handler error: ${e && e.message}`);
      return plain(500, 'Internal error');
    }
  };
}

const PRIVILEGED_SCHEME = Object.freeze({
  scheme: APP_SCHEME,
  privileges: Object.freeze({
    standard: true, // real origin semantics: relative URLs, localStorage, history API
    secure: true, // treated as a secure context
    supportFetchAPI: true,
    stream: true,
    // Deliberately NOT: bypassCSP, corsEnabled, allowServiceWorkers.
  }),
});

module.exports = { createAppProtocolHandler, PRIVILEGED_SCHEME };
