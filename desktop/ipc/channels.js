'use strict';

/**
 * The complete, closed set of IPC channels. Anything not listed here cannot be
 * invoked by the renderer. preload.js keeps its own literal copy (a sandboxed
 * preload cannot require local files); tests/preload.test.js fails if the two
 * lists ever drift apart.
 */
const INVOKE_CHANNELS = Object.freeze([
  'app:getInfo',
  'app:openSetup',
  'config:get',
  'config:setBackendUrl',
  'config:testBackend',
  'secureStore:get',
  'secureStore:set',
  'secureStore:delete',
  'print:listPrinters',
  'print:currentPage',
  'print:receipt',
  'print:test',
  'print:openDrawer',
  'printers:getConfig',
  'printers:setConfig',
  'updates:getStatus',
  'updates:check',
  'updates:download',
  'updates:install',
  'diagnostics:get',
]);

/** main -> renderer push channels. */
const EVENT_CHANNELS = Object.freeze(['updates:status']);

module.exports = Object.freeze({ INVOKE_CHANNELS, EVENT_CHANNELS });
