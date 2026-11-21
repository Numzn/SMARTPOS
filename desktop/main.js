'use strict';

const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  protocol,
  net,
  shell,
  session,
  safeStorage,
  dialog,
} = require('electron');

const { APP_SCHEME, APP_ORIGIN, SETUP_PAGE_URL, DEFAULT_DEV_URL } = require('./config/constants');
const { createAppProtocolHandler, PRIVILEGED_SCHEME } = require('./services/appProtocol');
const { createConfigStore } = require('./services/configStore');
const { createSecureStore } = require('./services/secureStore');
const { createPrintService } = require('./services/printing');
const { createUpdater } = require('./services/updater');
const { createLogger } = require('./services/logger');
const { collectDiagnostics } = require('./services/diagnostics');
const { buildCsp } = require('./services/csp');
const { isAllowedNavigation, isSafeExternalUrl } = require('./services/navigationGuard');
const { buildMenuTemplate } = require('./services/menu');
const { registerIpc } = require('./ipc/register');

// Dev mode = running from source with the Vite dev server (scripts/dev.js sets this).
const isDev = !app.isPackaged && process.env.NUMZ_DESKTOP_DEV === '1';
const devUrl = process.env.NUMZ_DEV_URL || DEFAULT_DEV_URL;
const isMac = process.platform === 'darwin';

// Must run before app 'ready'.
protocol.registerSchemesAsPrivileged([PRIVILEGED_SCHEME]);

// Packaged builds force the Chromium sandbox on for every renderer and strip any
// --no-sandbox switch, so an installed copy cannot be launched with the sandbox
// disabled (e.g. via an edited shortcut). Unpackaged runs (development, and CI
// smoke tests in containers that run as root) honour the switch.
if (app.isPackaged) app.enableSandbox();

let mainWindow = null;
let services = null;

const trustedOrigins = isDev ? [APP_ORIGIN, new URL(devUrl).origin] : [APP_ORIGIN];

function appDistDir() {
  return path.join(__dirname, 'app-dist');
}

function loadDefaults() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'defaults.json'), 'utf8'));
  } catch {
    return {};
  }
}

function buildServices() {
  const userData = app.getPath('userData');
  const log = createLogger({ dir: path.join(userData, 'logs'), fs });
  const defaults = loadDefaults();
  const config = createConfigStore({
    dir: userData,
    fs,
    // Env override lets an operator pre-seed the server address for a fleet.
    defaults: { backendUrl: process.env.NUMZ_BACKEND_URL || defaults.backendUrl || '' },
  });
  const secureStore = createSecureStore({ safeStorage, fs, dir: userData });

  let engine;
  try {
    engine = require('./vendor/receipt-engine/index.cjs');
  } catch (e) {
    log.error(`Receipt engine missing (run "npm run prepare:vendor"): ${e.message}`);
    engine = {
      buildEscPosCommands: () => {
        throw new Error('The receipt engine is not bundled in this build.');
      },
    };
  }
  const printing = createPrintService({ getConfig: () => config.get(), engine });

  let autoUpdater = null;
  const feedUrl = process.env.NUMZ_UPDATE_URL || loadDefaults().updateUrl || '';
  if (app.isPackaged && feedUrl) {
    try {
      ({ autoUpdater } = require('electron-updater'));
    } catch (e) {
      log.error(`electron-updater unavailable: ${e.message}`);
    }
  }
  const updater = createUpdater({
    autoUpdater: autoUpdater || { on() {}, setFeedURL() {} },
    feedUrl: autoUpdater ? feedUrl : '',
    channel: process.env.NUMZ_UPDATE_CHANNEL || 'latest',
    isPackaged: app.isPackaged,
    onStatus: (s) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updates:status', s);
    },
  });

  return { log, config, secureStore, printing, updater };
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'NUMZ POS',
    backgroundColor: '#f4f5f7',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: isDev,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  const allowedOrigins = trustedOrigins;
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, allowedOrigins)) {
      event.preventDefault();
      services.log.warn('Blocked in-window navigation to a foreign origin');
    }
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url, allowedOrigins)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Never open a new privileged window. Plain https links go to the user's browser.
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

function loadApp(win) {
  if (isDev) return win.loadURL(devUrl);
  const { backendUrl } = services.config.get();
  return win.loadURL(backendUrl ? `${APP_ORIGIN}/` : SETUP_PAGE_URL);
}

function openSetup() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(SETUP_PAGE_URL);
}

function installSessionHardening() {
  // Deny every permission prompt (camera, mic, geolocation, notifications, ...).
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  if (isDev) return;
  // Packaged builds never talk to anything but our own scheme.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    // Requests the main process makes itself (net.fetch to the configured backend,
    // via the /api proxy) carry no web contents and must pass; only page-initiated
    // requests are restricted to our own scheme.
    if (details.webContentsId === undefined) return cb({ cancel: false });
    const u = details.url;
    const ok = u.startsWith(`${APP_SCHEME}://`) || u.startsWith('devtools://') || u.startsWith('data:') || u.startsWith('blob:');
    cb({ cancel: !ok });
  });
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    services = buildServices();
    const { log, config } = services;
    log.info(`NUMZ POS ${app.getVersion()} starting (packaged=${app.isPackaged}, dev=${isDev})`);

    if (!isDev) {
      const handler = createAppProtocolHandler({
        appDistDir: appDistDir(),
        desktopPagesDir: path.join(__dirname, 'renderer'),
        fs,
        getBackendOrigin: () => config.get().backendUrl,
        fetchImpl: (url, init) => net.fetch(url, init),
        csp: buildCsp(),
        log,
      });
      protocol.handle(APP_SCHEME, handler);
    }

    installSessionHardening();

    registerIpc({
      ipcMain,
      trustedOrigins,
      services: {
        app: {
          info: () => ({
            name: app.getName(),
            version: app.getVersion(),
            platform: process.platform,
            arch: process.arch,
            packaged: app.isPackaged,
            electron: process.versions.electron,
          }),
        },
        config,
        secureStore: services.secureStore,
        printing: services.printing,
        updater: services.updater,
        diagnostics: () =>
          collectDiagnostics({
            app,
            versions: process.versions,
            config,
            secureStore: services.secureStore,
            updater: services.updater,
            logger: log,
            fetchImpl: (url, init) => net.fetch(url, init),
            platform: { platform: process.platform, arch: process.arch },
          }),
      },
      onOpenSetup: openSetup,
      fetchImpl: (url, init) => net.fetch(url, init),
      log,
    });

    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        buildMenuTemplate({
          isDev,
          isMac,
          appName: 'NUMZ POS',
          onOpenSetup: openSetup,
          onCheckUpdates: async () => {
            const r = await services.updater.check();
            if (!r.ok) dialog.showMessageBox({ type: 'info', message: 'Updates', detail: r.error || 'Could not check for updates.' });
          },
          onOpenLogs: () => shell.openPath(path.dirname(log.file)),
          onAbout: () =>
            dialog.showMessageBox({
              type: 'info',
              title: 'About NUMZ POS',
              message: 'NUMZ POS',
              detail: `Version ${app.getVersion()}\nNUMZ TECHNOLOGIES LIMITED`,
            }),
        })
      )
    );

    mainWindow = createMainWindow();
    loadApp(mainWindow).catch((e) => log.error(`Failed to load the app: ${e.message}`));
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && services) {
      mainWindow = createMainWindow();
      loadApp(mainWindow);
    }
  });
}
