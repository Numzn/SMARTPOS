'use strict';

/**
 * Validation of the backend origin the desktop client talks to.
 *
 * Policy: https is always allowed. Plain http is allowed only for loopback and
 * private-network hosts (a shop-local server on 192.168.x.x or localhost),
 * because credentials and the JWT would otherwise cross the public internet in
 * clear text. Credentials embedded in the URL are rejected, and path/query/hash
 * are dropped: the stored value is an origin, and the renderer's own /api/...
 * paths are appended to it.
 */

function isPrivateIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isLocalHost(host) {
  const h = host.toLowerCase();
  return h === 'localhost' || h === '[::1]' || h.endsWith('.localhost') || isPrivateIPv4(h);
}

/**
 * @returns {{ ok: true, origin: string } | { ok: false, error: string }}
 */
function normalizeBackendUrl(input) {
  if (typeof input !== 'string') return { ok: false, error: 'Server address is required.' };
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'Server address is required.' };
  if (trimmed.length > 300) return { ok: false, error: 'Server address is too long.' };

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Enter a full address such as https://pos.example.com' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'Only http:// and https:// addresses are supported.' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'The address must not contain a username or password.' };
  }
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) {
    return {
      ok: false,
      error: 'Use https:// for remote servers. Plain http:// is only allowed for this computer or a private network address.',
    };
  }

  return { ok: true, origin: url.origin };
}

module.exports = { normalizeBackendUrl, isPrivateIPv4, isLocalHost };
