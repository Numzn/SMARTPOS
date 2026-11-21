import { getRequestToken, clearToken } from './tokenStore';
import { reportReachable, reportNetworkFailure } from './connectivity';

const configured = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Relative VITE_API_URL (e.g. "/api") is already the API prefix on the same origin.
// Absolute host URLs (dev) need "/api" appended once.
function resolveApiBase() {
  if (configured.startsWith('/')) {
    return configured.replace(/\/$/, '');
  }
  const root = configured.replace(/\/$/, '');
  return root.endsWith('/api') ? root : `${root}/api`;
}

export const API_ROOT = configured.startsWith('/')
  ? configured.replace(/\/$/, '')
  : configured.replace(/\/$/, '');
export const API_BASE = resolveApiBase();

export function getAuthToken() {
  return getRequestToken() || null;
}

export function getAuthHeaders(extra = {}) {
  const token = getAuthToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

/** Axios-compatible error shape for existing callers (error.response.data). */
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.response = { status, data };
    // 'auth'     — the session is invalid (401): the only kind that may sign a user out.
    // 'network'  — a gateway between us and the server failed (502/504); the server
    //              itself did not answer. NOT 503: our own routes use it for
    //              business conditions such as "VSDC device not initialized".
    // 'business' — the server answered and said no (validation, permission, ...).
    this.kind = status === 401 ? 'auth' : status === 502 || status === 504 ? 'network' : 'business';
  }
}

/**
 * The request never got an answer (offline, DNS, refused, timed out). Has NO
 * `.response`, exactly like the raw TypeError it replaces, so existing
 * `!error.response` checks keep working; `kind === 'network'` is the explicit test.
 * Note: the request may or may not have reached the server before the link
 * dropped; callers that create something must not assume either way.
 */
export class NetworkError extends Error {
  constructor(message = 'Cannot reach the server. Check the connection and try again.', cause) {
    super(message);
    this.name = 'NetworkError';
    this.kind = 'network';
    if (cause) this.cause = cause;
  }
}

function handleUnauthorized(status, path) {
  if (status === 401 && !String(path).includes('/login')) {
    clearToken();
    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login';
    }
  }
}

function resolveUrl(path) {
  if (path.startsWith('http')) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}

/**
 * Single HTTP client for all frontend API calls (fetch-based).
 */
export async function apiFetch(path, options = {}) {
  const url = resolveUrl(path);
  // `timeoutMs` is ours, not fetch's: strip it and turn it into an abort signal.
  const { timeoutMs, ...fetchOptions } = options;
  let res;
  try {
    res = await fetch(url, {
      ...fetchOptions,
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      headers: { ...getAuthHeaders(), ...fetchOptions.headers },
    });
  } catch (e) {
    reportNetworkFailure();
    throw new NetworkError(undefined, e);
  }
  if (res.status === 502 || res.status === 504) reportNetworkFailure();
  else reportReachable();

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    handleUnauthorized(res.status, path);
    throw new ApiError(data?.error || res.statusText || 'Request failed', res.status, data);
  }

  return data;
}

function request(method, path, body, config = {}) {
  const init = { method, ...config };
  if (body !== undefined && body !== null) {
    init.body = JSON.stringify(body);
  }
  return apiFetch(path, init).then((data) => ({ data, status: 200 }));
}

/** Axios-shaped helper — prefer apiFetch for new code. */
export const api = {
  get: (path, config) => request('GET', path, undefined, config),
  delete: (path, config) => request('DELETE', path, undefined, config),
  post: (path, body, config) => request('POST', path, body, config),
  put: (path, body, config) => request('PUT', path, body, config),
  patch: (path, body, config) => request('PATCH', path, body, config),
};

export default api;
