'use strict';

/**
 * Pure helpers for the numzpos://app/api/* -> backend proxy. This reproduces
 * what nginx does for the Docker web deployment (smart-pos-frontend/nginx.conf:
 * `location /api/ { proxy_pass http://backend:4000/api/; }`), so the renderer
 * keeps calling same-origin `/api/...` exactly as in the web build and never
 * needs to know, or be trusted with, the backend origin.
 */

/** Request headers the renderer may forward. Everything else is dropped. */
const FORWARDED_HEADERS = new Set([
  'authorization',
  'content-type',
  'accept',
  'accept-language',
  'if-none-match',
  'if-modified-since',
]);

/**
 * @returns {{ok:true, target:string} | {ok:false, status:number, error:string}}
 */
function buildProxyTarget(backendOrigin, requestUrl) {
  if (!backendOrigin) {
    return { ok: false, status: 503, error: 'No server is configured. Open File > Server settings.' };
  }
  let req;
  try {
    req = new URL(requestUrl);
  } catch {
    return { ok: false, status: 400, error: 'Bad request URL.' };
  }
  // new URL() has already resolved dot-segments; refuse anything outside /api.
  if (req.pathname !== '/api' && !req.pathname.startsWith('/api/')) {
    return { ok: false, status: 404, error: 'Not an API path.' };
  }
  const target = new URL(req.pathname + req.search, backendOrigin);
  if (target.origin !== new URL(backendOrigin).origin) {
    return { ok: false, status: 400, error: 'Refusing to leave the configured server.' };
  }
  return { ok: true, target: target.toString() };
}

/** @param {Iterable<[string,string]>} entries */
function filterRequestHeaders(entries) {
  const out = {};
  for (const [name, value] of entries) {
    const key = name.toLowerCase();
    if (FORWARDED_HEADERS.has(key) || key.startsWith('x-')) out[key] = value;
  }
  return out;
}

module.exports = { buildProxyTarget, filterRequestHeaders, FORWARDED_HEADERS };
