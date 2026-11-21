/**
 * Read-only JWT helpers. These do NOT verify signatures; the server does that
 * on every request. They exist only so the client can tell, without a network,
 * whether a stored token has expired and whom it was issued to, to decide if a
 * saved offline session may be shown until the server can re-validate it.
 */
function base64UrlDecode(segment) {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded); // browsers and Electron always provide atob
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/** True only when the token has an `exp` claim that is still in the future. */
export function isTokenUnexpired(token, now = Date.now()) {
  const payload = decodeJwtPayload(token);
  return !!payload && typeof payload.exp === 'number' && payload.exp * 1000 > now;
}

export function tokenUserId(token) {
  const payload = decodeJwtPayload(token);
  return payload && payload.userId != null ? payload.userId : null;
}
