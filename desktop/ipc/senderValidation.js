'use strict';

/**
 * `new URL('numzpos://app/x').origin` is the string "null" for non-special
 * schemes, so origins are compared as protocol + host instead.
 */
function originOf(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * A sender is trusted only when it is the top-level frame of a page we serve
 * ourselves. Sub-frames and any foreign origin are rejected.
 */
function isTrustedFrame({ url, isMainFrame }, trustedOrigins) {
  if (!isMainFrame) return false;
  const origin = originOf(url);
  return origin !== null && trustedOrigins.includes(origin);
}

/** Extract the facts we validate from an Electron IpcMainInvokeEvent. */
function describeSender(event) {
  const frame = event && event.senderFrame;
  if (!frame) return { url: '', isMainFrame: false };
  return { url: frame.url || '', isMainFrame: frame.parent == null };
}

function isTrustedSender(event, trustedOrigins) {
  return isTrustedFrame(describeSender(event), trustedOrigins);
}

module.exports = { originOf, isTrustedFrame, describeSender, isTrustedSender };
