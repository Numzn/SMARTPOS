import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { INVOKE_CHANNELS, EVENT_CHANNELS } = require('../ipc/channels');

const preloadSource = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');

function loadPreload() {
  const exposed = {};
  const ipcRenderer = {
    invoke: vi.fn(async () => 'ok'),
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
  };
  const electron = {
    contextBridge: { exposeInMainWorld: (name, api) => (exposed[name] = api) },
    ipcRenderer,
  };
  // Sandboxed preloads only get `require('electron')` and a few builtins; mimic that.
  const fakeRequire = (id) => {
    if (id === 'electron') return electron;
    throw new Error(`preload tried to require "${id}"`);
  };
  vm.runInNewContext(`(function (require) { ${preloadSource} })`, { console })(fakeRequire);
  return { exposed, ipcRenderer };
}

describe('preload bridge', () => {
  it('keeps its literal allowlists identical to ipc/channels.js', () => {
    const grab = (name) => {
      const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(preloadSource);
      return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    };
    expect(grab('INVOKE_CHANNELS').sort()).toEqual([...INVOKE_CHANNELS].sort());
    expect(grab('EVENT_CHANNELS').sort()).toEqual([...EVENT_CHANNELS].sort());
  });

  it('exposes only window.numzDesktop and requires nothing but electron', () => {
    const { exposed } = loadPreload();
    expect(Object.keys(exposed)).toEqual(['numzDesktop']);
    expect(exposed.numzDesktop.isDesktop).toBe(true);
  });

  it('does not leak ipcRenderer, require, process or fs to the page', () => {
    const { exposed } = loadPreload();
    const api = exposed.numzDesktop;
    const flat = JSON.stringify(Object.keys(api)) + JSON.stringify(Object.values(api).map((v) => (typeof v === 'object' ? Object.keys(v) : v)));
    for (const forbidden of ['ipcRenderer', 'require', 'process', 'fs', 'child_process', 'shell', 'send', 'invoke', 'exec']) {
      expect(flat).not.toContain(`"${forbidden}"`);
    }
  });

  it('is frozen: the page cannot replace bridge functions', () => {
    const { exposed } = loadPreload();
    expect(Object.isFrozen(exposed.numzDesktop)).toBe(true);
    expect(Object.isFrozen(exposed.numzDesktop.secureStore)).toBe(true);
  });

  it('forwards only allowlisted channels to ipcRenderer.invoke', async () => {
    const { exposed, ipcRenderer } = loadPreload();
    await exposed.numzDesktop.secureStore.get('auth.token');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('secureStore:get', 'auth.token');
  });

  it('covers every allowlisted channel with exactly one public function', async () => {
    const { exposed, ipcRenderer } = loadPreload();
    const fns = [];
    for (const group of Object.values(exposed.numzDesktop)) {
      if (group && typeof group === 'object') {
        for (const [name, fn] of Object.entries(group)) if (name !== 'onStatus') fns.push(fn);
      }
    }
    for (const fn of fns) await fn('x', 'y');
    const called = ipcRenderer.invoke.mock.calls.map((c) => c[0]).sort();
    expect(called).toEqual([...INVOKE_CHANNELS].sort());
  });

  it('push subscriptions hand over the payload only, never the IPC event', () => {
    const { exposed, ipcRenderer } = loadPreload();
    const cb = vi.fn();
    const off = exposed.numzDesktop.updates.onStatus(cb);
    const listener = ipcRenderer.on.mock.calls[0][1];
    listener({ sender: 'secret-event-object' }, { state: 'idle' });
    expect(cb).toHaveBeenCalledWith({ state: 'idle' });
    off();
    expect(ipcRenderer.removeListener).toHaveBeenCalled();
  });

  it('rejects non-function subscribers', () => {
    const { exposed } = loadPreload();
    expect(() => exposed.numzDesktop.updates.onStatus('nope')).toThrow('Blocked channel');
  });
});
