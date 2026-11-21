'use strict';

/**
 * Support/diagnostic snapshot. Contains no tokens, credentials, request data
 * or customer data: only versions, configuration state and reachability.
 */
async function checkBackend(origin, fetchImpl, timeoutMs = 5000) {
  if (!origin) return { configured: false, reachable: false };
  const started = Date.now();
  try {
    const res = await fetchImpl(`${origin}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    return { configured: true, reachable: res.ok, status: res.status, latencyMs: Date.now() - started };
  } catch (e) {
    return { configured: true, reachable: false, error: e && e.name === 'TimeoutError' ? 'Timed out' : 'Unreachable' };
  }
}

async function collectDiagnostics({ app, versions, config, secureStore, updater, logger, fetchImpl, platform }) {
  const cfg = config.get();
  return {
    app: { name: app.getName(), version: app.getVersion(), packaged: app.isPackaged },
    runtime: {
      electron: versions.electron,
      chrome: versions.chrome,
      node: versions.node,
      platform: platform.platform,
      arch: platform.arch,
    },
    backend: { origin: cfg.backendUrl || null, ...(await checkBackend(cfg.backendUrl, fetchImpl)) },
    secureStorageAvailable: secureStore.isAvailable(),
    printer: { mode: cfg.printer.mode, drawerOnCash: cfg.printer.openDrawerOnCash },
    updates: updater.getStatus(),
    logFile: logger.file,
  };
}

module.exports = { collectDiagnostics, checkBackend };
