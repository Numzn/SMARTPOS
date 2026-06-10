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

export async function apiFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
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
    const err = new Error(data?.error || res.statusText || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
