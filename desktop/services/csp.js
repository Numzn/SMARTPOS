'use strict';

/**
 * Content-Security-Policy for the bundled renderer.
 *
 * - script-src 'self': no inline scripts, no eval, no remote scripts.
 * - connect-src 'self': every network call goes through the numzpos://app/api
 *   proxy in the main process, so the renderer can reach nothing else.
 * - style-src needs 'unsafe-inline' because React renders inline style
 *   attributes. Scripts remain locked down, which is where the risk is.
 * - img-src allows data:/blob: for QR codes and generated receipt images.
 */
function buildCsp({ dev = false, devOrigin = '' } = {}) {
  const self = "'self'";
  const directives = {
    'default-src': [self],
    'script-src': [self],
    'style-src': [self, "'unsafe-inline'"],
    'img-src': [self, 'data:', 'blob:'],
    'font-src': [self, 'data:'],
    'connect-src': [self],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': [self],
    'frame-ancestors': ["'none'"],
  };
  if (dev && devOrigin) {
    const ws = devOrigin.replace(/^http/, 'ws');
    directives['script-src'].push(devOrigin, "'unsafe-inline'");
    directives['connect-src'].push(devOrigin, ws, 'http://localhost:4000');
    directives['style-src'].push(devOrigin);
  }
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

module.exports = { buildCsp };
