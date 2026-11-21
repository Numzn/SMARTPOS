/**
 * Server-reachability monitor.
 *
 * `navigator.onLine` only says the PC has *a* network; it says nothing about
 * whether OUR server is reachable, which is what a till actually needs. This
 * module tracks that, from two signals:
 *   1. a heartbeat (GET /api/health) while the monitor is running, and
 *   2. every real API call (apiFetch reports success or network failure).
 *
 * States: UNKNOWN (nothing observed yet) -> ONLINE | DEGRADED | OFFLINE.
 * One failed signal is DEGRADED (could be a blip); two in a row is OFFLINE;
 * any success is ONLINE. Pure module state, no React: hooks subscribe to it.
 */

const listeners = new Set();

let state = freshState();
let stop = null;
let checkNowImpl = null;

function freshState() {
  return { status: 'UNKNOWN', since: Date.now(), lastOkAt: null, consecutiveFailures: 0 };
}

function setState(next) {
  const changed = next.status !== state.status;
  state = {
    ...next,
    since: changed ? Date.now() : state.since,
  };
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      /* a broken subscriber must never break the signal */
    }
  });
}

export function getConnectivity() {
  return state;
}

export function subscribeConnectivity(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function reportReachable() {
  // Already healthy: nothing changed, nobody needs waking up.
  if (state.status === 'ONLINE' && state.consecutiveFailures === 0) return;
  setState({ status: 'ONLINE', lastOkAt: Date.now(), consecutiveFailures: 0 });
}

export function reportNetworkFailure() {
  const failures = state.consecutiveFailures + 1;
  setState({
    status: failures >= 2 ? 'OFFLINE' : 'DEGRADED',
    lastOkAt: state.lastOkAt,
    consecutiveFailures: failures,
  });
  // A failure observed by a normal request: confirm quickly instead of waiting
  // for the next scheduled heartbeat.
  if (checkNowImpl) checkNowImpl();
}

/** Ask the monitor to check immediately (no-op if it is not running). */
export function checkConnectivityNow() {
  if (checkNowImpl) return checkNowImpl();
  return Promise.resolve();
}

/**
 * Start the heartbeat. Returns a stop function. Safe to call once at startup.
 * @param {{healthUrl:string, fetchImpl?:typeof fetch, onlineIntervalMs?:number, offlineIntervalMs?:number, timeoutMs?:number}} opts
 */
export function startConnectivityMonitor({
  healthUrl,
  fetchImpl = (...a) => fetch(...a),
  onlineIntervalMs = 15_000,
  offlineIntervalMs = 5_000,
  timeoutMs = 5_000,
} = {}) {
  if (stop) stop();

  let timer = null;
  let running = true;
  let inFlight = null;

  async function beat() {
    if (!running) return;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const res = await fetchImpl(healthUrl, {
          method: 'GET',
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) reportReachable();
        else markFailure();
      } catch {
        markFailure();
      } finally {
        inFlight = null;
        schedule();
      }
    })();
    return inFlight;
  }

  // Heartbeat failures update state directly: calling reportNetworkFailure()
  // here would re-trigger beat() through checkNowImpl.
  function markFailure() {
    const failures = state.consecutiveFailures + 1;
    setState({
      status: failures >= 2 ? 'OFFLINE' : 'DEGRADED',
      lastOkAt: state.lastOkAt,
      consecutiveFailures: failures,
    });
  }

  function schedule() {
    if (!running) return;
    clearTimeout(timer);
    const healthy = state.status === 'ONLINE' || state.status === 'UNKNOWN';
    timer = setTimeout(beat, healthy ? onlineIntervalMs : offlineIntervalMs);
  }

  const onBrowserOnline = () => beat();
  const onBrowserOffline = () => {
    // The OS itself says there is no network: certain, no need to wait for two misses.
    setState({ status: 'OFFLINE', lastOkAt: state.lastOkAt, consecutiveFailures: Math.max(2, state.consecutiveFailures) });
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onBrowserOnline);
    window.addEventListener('offline', onBrowserOffline);
  }

  checkNowImpl = () => {
    // Collapse bursts of failing requests into one immediate check.
    clearTimeout(timer);
    timer = setTimeout(beat, 0);
    return Promise.resolve();
  };

  beat();

  stop = () => {
    running = false;
    clearTimeout(timer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onBrowserOnline);
      window.removeEventListener('offline', onBrowserOffline);
    }
    checkNowImpl = null;
    stop = null;
  };
  return stop;
}

/** Test helper. */
export function __resetConnectivityForTests() {
  if (stop) stop();
  listeners.clear();
  state = freshState();
}
