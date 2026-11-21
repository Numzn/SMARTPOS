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
let memoryToken = null;

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

export function clearToken() {
  const bridge = getDesktopBridge();
  if (bridge) {
    memoryToken = null;
    bridge.secureStore.delete(SECURE_KEY).catch(() => {});
    return;
  }
  Cookies.remove('token');
  localStorage.removeItem('token');
}

/** Test helper: reset module state. */
export function __resetTokenStoreForTests() {
  memoryToken = null;
}
