import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getConnectivity,
  subscribeConnectivity,
  reportReachable,
  reportNetworkFailure,
  checkConnectivityNow,
  startConnectivityMonitor,
  __resetConnectivityForTests,
} from './connectivity';

beforeEach(() => {
  __resetConnectivityForTests();
});
afterEach(() => {
  __resetConnectivityForTests();
  vi.useRealTimers();
});

describe('connectivity state machine', () => {
  it('starts UNKNOWN: nothing observed yet is not a failure', () => {
    expect(getConnectivity().status).toBe('UNKNOWN');
  });

  it('one failure is DEGRADED, two in a row is OFFLINE, any success is ONLINE again', () => {
    reportNetworkFailure();
    expect(getConnectivity().status).toBe('DEGRADED');
    reportNetworkFailure();
    expect(getConnectivity().status).toBe('OFFLINE');
    reportReachable();
    expect(getConnectivity()).toMatchObject({ status: 'ONLINE', consecutiveFailures: 0 });
  });

  it('notifies subscribers on change, and does not wake them when nothing changed', () => {
    const fn = vi.fn();
    reportReachable();
    const off = subscribeConnectivity(fn);
    reportReachable(); // already healthy
    expect(fn).not.toHaveBeenCalled();
    reportNetworkFailure();
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    reportNetworkFailure();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('records when the current state began', () => {
    reportReachable();
    const t = getConnectivity().since;
    reportReachable();
    expect(getConnectivity().since).toBe(t);
    reportNetworkFailure();
    expect(getConnectivity().since).toBeGreaterThanOrEqual(t);
  });

  it('a throwing subscriber cannot break the signal', () => {
    subscribeConnectivity(() => {
      throw new Error('boom');
    });
    const ok = vi.fn();
    subscribeConnectivity(ok);
    expect(() => reportNetworkFailure()).not.toThrow();
    expect(ok).toHaveBeenCalled();
  });
});

describe('heartbeat monitor', () => {
  const res = (ok) => ({ ok, status: ok ? 200 : 503 });

  it('goes ONLINE when the health endpoint answers', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => res(true));
    startConnectivityMonitor({ healthUrl: '/api/health', fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledWith('/api/health', expect.objectContaining({ method: 'GET', cache: 'no-store' }));
    expect(getConnectivity().status).toBe('ONLINE');
  });

  it('goes OFFLINE after two failed beats, polls faster while down, and recovers by itself', async () => {
    vi.useFakeTimers();
    let up = false;
    const fetchImpl = vi.fn(async () => {
      if (!up) throw new TypeError('Failed to fetch');
      return res(true);
    });
    startConnectivityMonitor({ healthUrl: '/h', fetchImpl, onlineIntervalMs: 15000, offlineIntervalMs: 5000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(getConnectivity().status).toBe('DEGRADED');
    await vi.advanceTimersByTimeAsync(5000);
    expect(getConnectivity().status).toBe('OFFLINE');
    const callsWhileDown = fetchImpl.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchImpl.mock.calls.length).toBe(callsWhileDown + 2); // every 5 s while down
    up = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(getConnectivity().status).toBe('ONLINE');
  });

  it('treats a non-OK health response as unreachable', async () => {
    vi.useFakeTimers();
    startConnectivityMonitor({ healthUrl: '/h', fetchImpl: async () => res(false), offlineIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(getConnectivity().status).toBe('OFFLINE');
  });

  it('the browser "offline" event is trusted immediately', async () => {
    vi.useFakeTimers();
    startConnectivityMonitor({ healthUrl: '/h', fetchImpl: async () => res(true) });
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('offline'));
    expect(getConnectivity().status).toBe('OFFLINE');
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(getConnectivity().status).toBe('ONLINE');
  });

  it('a failed real request triggers an immediate confirming check', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => res(true));
    startConnectivityMonitor({ healthUrl: '/h', fetchImpl, onlineIntervalMs: 60000 });
    await vi.advanceTimersByTimeAsync(0);
    const before = fetchImpl.mock.calls.length;
    reportNetworkFailure(); // e.g. a single dropped request while the server is actually fine
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl.mock.calls.length).toBe(before + 1);
    expect(getConnectivity().status).toBe('ONLINE'); // the check cleared the false alarm
  });

  it('checkConnectivityNow is a harmless no-op when the monitor is not running', async () => {
    await expect(checkConnectivityNow()).resolves.toBeUndefined();
  });

  it('stops polling when stopped', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => res(true));
    const stop = startConnectivityMonitor({ healthUrl: '/h', fetchImpl, onlineIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    const n = fetchImpl.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchImpl.mock.calls.length).toBe(n);
  });
});
