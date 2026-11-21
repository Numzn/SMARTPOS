import Cookies from 'js-cookie';
import { getDesktopBridge } from './desktop';

/**
 * Single place that knows where the auth token lives.
 *
 * Web (unchanged behaviour): a 7-day cookie plus a localStorage copy.
 * Desktop: the token is held in memory and persisted ONLY through the desktop
 * bridge's OS-backed secure store (Windows DPAPI via Electron safeStorage), so
 * it never sits in plaintext in the app's browser profile. If the OS cannot
 * encrypt, the session simply lasts until the app is closed.
 */

const SECURE_KEY = 'auth.token';
const SESSION_KEY = 'auth.session';
const MAX_SESSION_CHARS = 7000; // keep below the desktop secure store's 8 KB value cap
let memoryToken = null;
let memorySession = null;

/** Call once before first render. A no-op in the browser. */
export async function hydrateTokenStore() {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  try {
    const saved = await bridge.secureStore.get(SECURE_KEY);
    memoryToken = typeof saved === 'string' && saved ? saved : null;
  } catch {
    memoryToken = null;
  }
  try {
    const rawSession = await bridge.secureStore.get(SESSION_KEY);
    memorySession = typeof rawSession === 'string' && rawSession ? JSON.parse(rawSession) : null;
  } catch {
    memorySession = null;
  }
}

/** Initial auth state. Web reads the cookie only (exactly as before). */
export function getInitialToken() {
  if (getDesktopBridge()) return memoryToken || undefined;
  return Cookies.get('token');
}

/** Token attached to API requests. Web: cookie, then localStorage (exactly as before). */
export function getRequestToken() {
  if (getDesktopBridge()) return memoryToken || undefined;
  return Cookies.get('token') || localStorage.getItem('token') || undefined;
}

export function saveToken(token) {
  const bridge = getDesktopBridge();
  if (bridge) {
    memoryToken = token;
    // Best effort: failure only means "ask for the password again next launch".
    bridge.secureStore.set(SECURE_KEY, token).catch(() => {});
    return;
  }
  // secure only on HTTPS: localhost dev uses http
  Cookies.set('token', token, {
    expires: 7,
    secure: window.location.protocol === 'https:',
    sameSite: 'lax',
  });
  localStorage.setItem('token', token);
}

/**
 * Last known signed-in user (id, role, permissions...), kept so the app can
 * show the cashier's session while the server is unreachable. Desktop: also
 * persisted through the OS secure store. Browser: memory only (the web build
 * stays online-first). It is a convenience snapshot, never an authority: the
 * server re-validates it as soon as it can be reached.
 */
export function saveSession(user) {
  memorySession = user && typeof user === 'object' ? user : null;
  const bridge = getDesktopBridge();
  if (!bridge || !memorySession) return;
  try {
    const text = JSON.stringify(memorySession);
    if (text.length > MAX_SESSION_CHARS) return;
    bridge.secureStore.set(SESSION_KEY, text).catch(() => {});
  } catch {
    /* unserialisable: keep the in-memory copy only */
  }
}

export function getCachedSession() {
  return memorySession;
}

export function clearToken() {
  const bridge = getDesktopBridge();
  memorySession = null;
  if (bridge) {
    memoryToken = null;
    bridge.secureStore.delete(SECURE_KEY).catch(() => {});
    bridge.secureStore.delete(SESSION_KEY).catch(() => {});
    return;
  }
  Cookies.remove('token');
  localStorage.removeItem('token');
}

/** Test helper: reset module state. */
export function __resetTokenStoreForTests() {
  memoryToken = null;
  memorySession = null;
}
