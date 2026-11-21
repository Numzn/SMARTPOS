# NUMZ POS Desktop (Electron)

The desktop app is a thin, hardened shell around the **existing** NUMZ POS web client. It adds an
installer, a native window, OS-protected sign-in storage, and local printer/cash-drawer access. It
does **not** contain business logic, a database, or any ZRA/VSDC credentials: every sale, refund,
permission check and fiscal submission still happens on the NUMZ backend.

Investigation findings and the reasons behind these choices: [DESKTOP_INVESTIGATION_REPORT.md](./DESKTOP_INVESTIGATION_REPORT.md).

## 1. Architecture

```
NUMZ POS Desktop (Windows)
 ├─ Renderer  = the existing React build, served from  numzpos://app/   (sandboxed, no Node)
 │     └─ fetch('/api/...')  ── same-origin, exactly like the Docker/nginx web build
 ├─ Preload   = window.numzDesktop  (frozen, allowlisted IPC functions only)
 └─ Main      = window + menu + protocol handler + services
       ├─ numzpos://app/api/*  ──HTTPS──►  configured NUMZ backend (Express → Prisma → PostgreSQL → ZRA/VSDC)
       ├─ secureStore   (Electron safeStorage → Windows DPAPI)
       ├─ printing      (LAN ESC/POS over TCP, or Windows printer driver)
       └─ updater       (electron-updater, off unless a feed is configured)
```

Key decisions:

* **Custom scheme, not `file://`.** The web app uses `BrowserRouter` and absolute paths (`/login`).
  Serving it from `numzpos://app/` with SPA fallback means the web build is used **unchanged**.
* **The main process proxies `/api/*`** to the configured backend (what nginx does in Docker). The
  renderer never learns the backend address, needs no CORS, and can reach nothing else (CSP
  `connect-src 'self'`).
* **`desktop/` is a standalone npm package, not a workspace.** Adding Electron to the root workspace
  would change the root lockfile used by the backend/frontend Docker builds.
* **Web behaviour is untouched.** Every frontend change is guarded by "is `window.numzDesktop`
  present".

## 2. Files

| Path | Purpose |
|---|---|
| `desktop/main.js` | Lifecycle, window, menu, session hardening, wiring |
| `desktop/preload.js` | The only bridge (`window.numzDesktop`) |
| `desktop/ipc/` | `channels.js` (closed allowlist), `senderValidation.js`, `register.js` (handlers) |
| `desktop/services/` | `appProtocol`, `backendProxy`, `staticResolver`, `csp`, `navigationGuard`, `configStore`, `secureStore`, `backendUrl`, `printing`, `escposPrinter`, `updater`, `diagnostics`, `logger`, `menu` |
| `desktop/renderer/` | Bundled server-setup page (shown until a server address is saved) |
| `desktop/config/` | `constants.js`, `defaults.json` (ships **empty**) |
| `desktop/scripts/` | `dev.js`, `build-renderer.js`, `prepare-vendor.js`, `generate-icon.js` |
| `desktop/electron-builder.yml` | NSIS installer configuration |
| `desktop/tests/` | Vitest suites for everything above |
| `smart-pos-frontend/src/lib/{desktop,tokenStore}.js` | Bridge access; token storage (web unchanged, desktop = OS secure store) |
| `smart-pos-frontend/src/lib/printReceipt.js` | Desktop-aware receipt routing (falls back to the existing paths) |
| `smart-pos-frontend/src/components/desktop/DesktopPanel.jsx` | Desktop-only settings, shown on **Devices** |

## 3. Development

Prerequisites: Node 20+, and the repository dependencies installed once at the root (`npm install`).

```bash
# 1. start the backend as usual (Docker or `npm run backend` at the repo root)
# 2. one-time desktop install
cd desktop && npm install
# 3. run the desktop app with hot module replacement
npm run dev
```

`npm run dev` starts the Vite dev server (HMR) and Electron pointed at it, with DevTools and
**Reload** enabled. In dev the renderer calls the backend directly through the frontend's own
`VITE_API_URL` (default `http://localhost:4000`), the same as the browser dev flow.

Run the desktop tests:

```bash
cd desktop && npm test
```

## 4. Production build and installer

```bash
cd desktop
npm install
npm run build:renderer   # builds receipt-engine + the React app exactly like Docker (VITE_API_URL=/api)
npm run dist             # -> desktop/release/NUMZ-POS-Setup.exe
```

* **Output:** `desktop/release/NUMZ-POS-Setup.exe` (plus `latest.yml` and a `.blockmap` for updates).
* `npm run pack` builds an unpacked app (`release/win-unpacked/`) without the installer, for quick checks.
* Building the Windows installer on Windows needs nothing extra. On Linux/macOS it needs **Wine**;
  the simplest way is the official builder image:

```bash
docker run --rm -v "$PWD/..":/project -w /project/desktop \
  -e ELECTRON_CACHE=/tmp/ec -e ELECTRON_BUILDER_CACHE=/tmp/ebc \
  electronuserland/builder:wine \
  bash -c "npm install && npm run dist"
```

The installer is **per-user** (no administrator rights), lets the user choose the folder, creates Start
menu and desktop shortcuts, registers an uninstaller, supports in-place upgrade, and keeps user data
(server address, printer settings, logs) when uninstalling or upgrading.

## 4a. Download page on Numzlab

Published **2026-11-21 at the owner's explicit request**:

* Page: <https://pos.lab.numz.site/download> &middot; file: `https://pos.lab.numz.site/downloads/NUMZ-POS-Setup.exe`
  (SHA-256 on the page and in `downloads/SHA256SUMS.txt`).
* Served by the existing `smart-pos-frontend` container from a read-only bind mount of `./downloads`
  (`docker-compose.yml`), via two routes added to `smart-pos-frontend/nginx.conf` (and the equivalent in
  `Caddyfile` for the `deploy-numzlab.sh` path; syntax-validated only). The React app and the shared
  gateway were not changed or rebuilt.
* The installer itself is git-ignored. To publish a new build: copy it to `downloads/`, refresh
  `downloads/SHA256SUMS.txt` and the hash/size in `downloads/download.html`. No container restart is needed
  (the folder is a live mount).
* A direct link inside the React UI is not added yet; that needs a normal frontend rebuild/deploy.

### Branding
`desktop/build/icon.png` is a **generated placeholder** (`npm run icon`). Replace it with the official
NUMZ artwork (PNG, 512×512 or larger) before distributing.

### Code signing
Not configured (no certificate exists in this repo). Unsigned installers trigger Windows SmartScreen
warnings. To sign, set `CSC_LINK` and `CSC_KEY_PASSWORD` in the **build environment only**; never
commit them.

## 5. Configuration

| Setting | Where | Notes |
|---|---|---|
| Backend address | First-run **Server settings** page, or *File → Server settings…* | Stored per user as an origin, e.g. `https://pos.example.com`. `https` required except for localhost/private-network addresses. |
| Pre-seed for a fleet | env `NUMZ_BACKEND_URL` or `desktop/config/defaults.json` `backendUrl` | Applies only until the user chooses one. Ships empty. |
| Printer / drawer | **Devices → This computer** | Stored per user. |
| Update feed | env `NUMZ_UPDATE_URL` (https) or `defaults.json` `updateUrl`; channel `NUMZ_UPDATE_CHANNEL` | Off unless set. |
| User data | `%APPDATA%\NUMZ POS\` | `config.json`, `secure.json` (encrypted), `logs\main.log` |

No `.env` file is read or packaged. No secrets are compiled in.

## 6. Security model

* `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`; DevTools and
  Reload only in development; single-instance lock.
* **Preload bridge:** a frozen object of explicit functions. No `ipcRenderer`, `require` or Node globals
  reach the page. The channel list is closed; a test fails if the preload and `ipc/channels.js` drift.
* **Every IPC handler validates its sender:** only the top-level frame of `numzpos://app` (or the dev
  server in development) is accepted. Sub-frames and foreign origins are rejected before any handler runs.
  Arguments are validated again inside each handler.
* **CSP** on every response: `script-src 'self'` (no inline/eval), `connect-src 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'`. Packaged builds also cancel any request that is not our scheme.
* **Navigation:** foreign in-window navigation is blocked; new windows are denied; only plain `https:`
  links open in the user's browser; `<webview>` is blocked; all permission prompts are denied.
* **Token at rest:** the JWT is held in memory and persisted with Electron `safeStorage` (Windows DPAPI).
  There is **no plaintext fallback**: if the OS cannot encrypt, the user signs in again each launch.
  Only the key `auth.token` is accepted by the secure store.
* **Static server** rejects `..`, encoded traversal, backslashes, NUL bytes and dotfiles.
* **Proxy** forwards only an allowlist of headers (never cookies/Origin), only `/api/*`, only to the
  configured origin, with a 60 s timeout (same as nginx).
* **Printer hosts** for raw ESC/POS must be loopback/private-network/local names, so the desktop cannot be
  used to push raw TCP to arbitrary internet hosts.
* **Logs** never contain request bodies or headers; bearer tokens/JWTs are masked as a backstop.
* **No ZRA/VSDC credential, JWT secret or database credential exists in the app.** The backend remains
  the only fiscal actor.

Residual risks (see §9): unsigned builds; the web app's own `cors()` is still open; a compromised
*backend* can still serve malicious API data (the renderer treats API data as before).

## 7. Hardware

| Device | Support | Notes |
|---|---|---|
| USB barcode scanner | Works as before (HID keyboard-wedge) | No new dependency. Nothing changed. |
| Network thermal printer | ESC/POS over TCP from the till PC | Bytes come from the shared `@smartpos/receipt-engine`, so output equals the web path. Test page button included. |
| Windows printer driver | Silent print of the on-screen receipt to a named printer, or the Windows print dialog | Uses Chromium's print pipeline; no native module. |
| Cash drawer | Opens via the printer's `ESC p` pulse **only** with a network ESC/POS printer, and only if enabled | The receipt engine always includes the pulse for CASH; the desktop strips it unless "Open the cash drawer" is enabled. Drivers installed in Windows cannot send the drawer command; the UI says so. |

**Untested on real hardware.** Everything above is covered by automated tests with a local TCP listener
and mocks. Verify with an actual printer and drawer before go-live.

## 8. Updates

`electron-updater` with a generic **https** feed. Disabled unless a feed is configured **and** the app
is packaged, so the first installer needs no update infrastructure. It never downloads or installs
automatically (a restart mid-sale would be harmful); the user checks, downloads, then chooses
*Restart and install* on **Devices**. Downloads are checked against the SHA-512 in `latest.yml`; on a
**signed** build the publisher signature is verified too. Until a signing certificate exists, treat the
update feed as trusted-infrastructure-only. Rollback: keep the previous installer; a failed update leaves
the installed version in place.

## 9. Known limitations

1. **Offline sales are NOT implemented.** The backend currently has no idempotency keys and `Sale.status`
   mixes commercial and fiscal state; a local queue on top would risk duplicates or mislabelled fiscal
   state. The design and prerequisites are in [REARCHITECTURE_CASE_STUDY.md](./REARCHITECTURE_CASE_STUDY.md).
   Today the desktop needs the backend to be reachable to sell, exactly like the web app.
2. **No code signing** and **placeholder icon**.
3. **Windows x64 only.** The code has no Windows-specific logic outside the installer config, so macOS/Linux
   targets are a configuration addition, but they have not been built or tested.
4. Hardware is untested on real devices (§7).
5. The existing web `PrinterProfile` settings page configures *server-side* printers; the desktop's local
   printer settings are separate and live on **Devices → This computer**.
6. Windows driver silent printing requires naming the printer; the paper size comes from the driver's default.
7. Desktop printing of **non-receipt** pages (shift reports) still uses the standard print dialog.
