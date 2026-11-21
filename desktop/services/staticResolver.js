'use strict';

const path = require('path');

/**
 * Maps a request pathname to a file under a fixed root, with SPA fallback.
 * Pure apart from the injected `statFile`, so path-traversal handling is
 * unit-testable without Electron.
 */

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
});

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/**
 * @param {string} root absolute directory to serve from
 * @param {string} pathname URL pathname (already without query/hash)
 * @param {(absPath: string) => boolean} isFile
 * @returns {{kind:'file'|'spa', file:string} | {kind:'notfound'} | {kind:'forbidden'}}
 */
function resolveStatic(root, pathname, isFile) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { kind: 'forbidden' };
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { kind: 'forbidden' };

  const segments = decoded.split('/').filter(Boolean);
  // No traversal and no hidden files (.env, .git, ...) regardless of encoding.
  if (segments.some((s) => s === '..' || s === '.' || s.startsWith('.'))) return { kind: 'forbidden' };

  const rootResolved = path.resolve(root);
  const target = path.resolve(rootResolved, ...segments);
  const rel = path.relative(rootResolved, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { kind: 'forbidden' };

  if (segments.length > 0 && isFile(target)) return { kind: 'file', file: target };

  // Asset-looking requests that do not exist are real 404s (never index.html).
  const last = segments[segments.length - 1] || '';
  if (path.extname(last)) return { kind: 'notfound' };

  const index = path.join(rootResolved, 'index.html');
  return isFile(index) ? { kind: 'spa', file: index } : { kind: 'notfound' };
}

module.exports = { resolveStatic, mimeFor, MIME };
