import Cookies from 'js-cookie';

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
  return Cookies.get('token') || localStorage.getItem('token');
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
  }
}

function handleUnauthorized(status, path) {
  if (status === 401 && !String(path).includes('/login')) {
    Cookies.remove('token');
    localStorage.removeItem('token');
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
  const res = await fetch(url, {
    ...options,
    headers: { ...getAuthHeaders(), ...options.headers },
  });

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
