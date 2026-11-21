'use strict';

/**
 * Sandboxed preload. The ONLY thing the renderer can reach is `window.numzDesktop`,
 * a frozen object of explicit functions. No `ipcRenderer`, no Node, no `require`.
 *
 * A sandboxed preload cannot require local files, so the channel allowlist is a
 * literal copy of ipc/channels.js; tests/preload.test.js fails if they drift.
 */
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE_CHANNELS = [
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
];
const EVENT_CHANNELS = ['updates:status'];

function invoke(channel, ...args) {
  if (!INVOKE_CHANNELS.includes(channel)) {
    return Promise.reject(new Error('Blocked channel'));
  }
  return ipcRenderer.invoke(channel, ...args);
}

function subscribe(channel, callback) {
  if (!EVENT_CHANNELS.includes(channel) || typeof callback !== 'function') {
    throw new Error('Blocked channel');
  }
  // The raw IPC event object is never handed to the page.
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  isDesktop: true,
  app: {
    getInfo: () => invoke('app:getInfo'),
    openSetup: () => invoke('app:openSetup'),
  },
  config: {
    get: () => invoke('config:get'),
    setBackendUrl: (url) => invoke('config:setBackendUrl', url),
    testBackend: (url) => invoke('config:testBackend', url),
  },
  secureStore: {
    get: (key) => invoke('secureStore:get', key),
    set: (key, value) => invoke('secureStore:set', key, value),
    delete: (key) => invoke('secureStore:delete', key),
  },
  print: {
    listPrinters: () => invoke('print:listPrinters'),
    currentPage: () => invoke('print:currentPage'),
    receipt: (viewModel) => invoke('print:receipt', viewModel),
    test: () => invoke('print:test'),
    openDrawer: () => invoke('print:openDrawer'),
  },
  printers: {
    getConfig: () => invoke('printers:getConfig'),
    setConfig: (config) => invoke('printers:setConfig', config),
  },
  updates: {
    getStatus: () => invoke('updates:getStatus'),
    check: () => invoke('updates:check'),
    download: () => invoke('updates:download'),
    install: () => invoke('updates:install'),
    onStatus: (callback) => subscribe('updates:status', callback),
  },
  diagnostics: {
    get: () => invoke('diagnostics:get'),
  },
};

for (const group of Object.values(api)) {
  if (group && typeof group === 'object') Object.freeze(group);
}
contextBridge.exposeInMainWorld('numzDesktop', Object.freeze(api));
