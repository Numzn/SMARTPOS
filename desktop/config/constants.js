'use strict';

/**
 * Shared constants for the NUMZ POS desktop main process.
 *
 * The renderer is served from a privileged custom scheme rather than file://.
 * Reason: the existing React app uses BrowserRouter and absolute paths
 * (`/login`, `/inventory`), which only work against a real origin with SPA
 * fallback. Serving it from numzpos://app/ means the web build is used
 * unchanged.
 */
const APP_SCHEME = 'numzpos';
const APP_HOST = 'app';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** Bundled desktop-only pages (server setup) live under this URL prefix. */
const DESKTOP_PAGES_PREFIX = '/__desktop/';
const SETUP_PAGE_URL = `${APP_ORIGIN}${DESKTOP_PAGES_PREFIX}setup.html`;

const DEFAULT_DEV_URL = 'http://localhost:5173';

/** Only these keys may ever be written to / read from the OS-backed secure store. */
const SECURE_STORE_KEYS = Object.freeze(['auth.token', 'auth.session']);
const MAX_SECURE_VALUE_BYTES = 8 * 1024;

/** Mirrors nginx `proxy_read_timeout 60s` in smart-pos-frontend/nginx.conf. */
const API_TIMEOUT_MS = 60_000;

module.exports = Object.freeze({
  APP_SCHEME,
  APP_HOST,
  APP_ORIGIN,
  DESKTOP_PAGES_PREFIX,
  SETUP_PAGE_URL,
  DEFAULT_DEV_URL,
  SECURE_STORE_KEYS,
  MAX_SECURE_VALUE_BYTES,
  API_TIMEOUT_MS,
});
