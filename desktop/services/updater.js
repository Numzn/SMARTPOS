'use strict';

/**
 * Application update state machine around electron-updater.
 *
 * - OFF by default. It activates only when a feed URL is configured (env
 *   NUMZ_UPDATE_URL) AND the app is packaged, so the first installer works
 *   with no update infrastructure at all.
 * - The feed must be https. Updates are never downloaded automatically and
 *   never installed without an explicit user action, so a cashier's open sale
 *   is not interrupted by a restart.
 * - Integrity: electron-updater verifies the SHA-512 in latest.yml against the
 *   downloaded installer, and on a code-signed build also verifies the
 *   publisher signature. Unsigned builds only get the former, so code signing
 *   must be in place before public distribution (see docs/DESKTOP.md).
 * - No signing credentials, tokens or private keys exist in this module.
 */

function createUpdater({ autoUpdater, feedUrl, channel = 'latest', isPackaged, onStatus = () => {} }) {
  let status = { state: 'disabled', reason: 'No update server is configured.' };

  const set = (next) => {
    status = next;
    try {
      onStatus(status);
    } catch {
      /* a closed window must never break the updater */
    }
  };

  const enabled = (() => {
    if (!isPackaged) {
      status = { state: 'disabled', reason: 'Updates are disabled in development builds.' };
      return false;
    }
    if (!feedUrl) return false;
    let u;
    try {
      u = new URL(feedUrl);
    } catch {
      status = { state: 'disabled', reason: 'The update server address is invalid.' };
      return false;
    }
    if (u.protocol !== 'https:') {
      status = { state: 'disabled', reason: 'The update server must use https.' };
      return false;
    }
    return true;
  })();

  if (enabled) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = channel !== 'latest';
    autoUpdater.channel = channel;
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    status = { state: 'idle' };

    autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
    autoUpdater.on('update-available', (info) => set({ state: 'available', version: info && info.version }));
    autoUpdater.on('update-not-available', () => set({ state: 'idle', upToDate: true }));
    autoUpdater.on('download-progress', (p) =>
      set({ state: 'downloading', percent: Math.round((p && p.percent) || 0) })
    );
    autoUpdater.on('update-downloaded', (info) => set({ state: 'downloaded', version: info && info.version }));
    autoUpdater.on('error', (err) =>
      set({ state: 'error', message: err && err.message ? String(err.message).slice(0, 300) : 'Update failed.' })
    );
  }

  const guard = () => (enabled ? null : { ok: false, error: status.reason || 'Updates are not available.' });

  return {
    enabled,
    getStatus: () => status,
    async check() {
      const g = guard();
      if (g) return g;
      try {
        await autoUpdater.checkForUpdates();
        return { ok: true };
      } catch (e) {
        set({ state: 'error', message: e && e.message ? String(e.message).slice(0, 300) : 'Update check failed.' });
        return { ok: false, error: status.message };
      }
    },
    async download() {
      const g = guard();
      if (g) return g;
      if (status.state !== 'available') return { ok: false, error: 'No update is available to download.' };
      try {
        await autoUpdater.downloadUpdate();
        return { ok: true };
      } catch (e) {
        set({ state: 'error', message: e && e.message ? String(e.message).slice(0, 300) : 'Download failed.' });
        return { ok: false, error: status.message };
      }
    },
    install() {
      const g = guard();
      if (g) return g;
      if (status.state !== 'downloaded') return { ok: false, error: 'No downloaded update to install.' };
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    },
  };
}

module.exports = { createUpdater };
