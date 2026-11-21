'use strict';

const { originOf } = require('../ipc/senderValidation');

/**
 * In-window navigation is allowed only within our own origin(s). Anything else
 * is blocked; plain https links may be handed to the user's default browser,
 * but never loaded inside the privileged window.
 */
function isAllowedNavigation(url, allowedOrigins) {
  const origin = originOf(url);
  return origin !== null && allowedOrigins.includes(origin);
}

/** Only https links are ever opened externally (no file:, javascript:, custom schemes). */
function isSafeExternalUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
}

module.exports = { isAllowedNavigation, isSafeExternalUrl };
