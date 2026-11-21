# NUMZ POS Desktop: Phase 0 Repository Investigation Report

> Investigated 2026-11-21 on `main` (HEAD `351df71`, uncommitted Forecourt work present). Read-only: no
> repository file was modified during the investigation. Everything below was verified in the repo or by a
> command run this session; items I could not verify are marked **UNVERIFIED**.

## 1. Existing architecture

| Layer | Finding | Evidence |
|---|---|---|
| Monorepo | npm workspaces: `packages/receipt-engine`, `smart-pos-frontend`, `smart-pos-backend`. Package manager is **npm** (root `package-lock.json`). | root `package.json` |
| Frontend | React 19 + Vite 7 + Tailwind 3 + `react-router-dom` v6 **`BrowserRouter`**. Entry `src/main.jsx` → `App.jsx`. Till and Dashboard eager, other pages lazy. | `smart-pos-frontend/package.json`, `src/App.jsx` |
| Backend | Express 5 + Prisma 6 + PostgreSQL 16. Routes under `/api/*`. `cors()` with **no options** (all origins). | `smart-pos-backend/index.js:41` |
| Fiscal | Backend-only: `lib/vsdc-gateway`, `services/vsdcService.js`, `services/zraInvoice.js`. Mock VSDC in dev/deploy; `VSDC_URL`/`VSDC_MODE` select real. **No ZRA credential is ever sent to the frontend.** | `docs/CODEBASE_GUIDE.md` §9, §16 |
| Receipts | Shared TS package `@smartpos/receipt-engine` with a **CJS build** (`dist/index.cjs`) exporting `buildEscPosCommands` (includes an `ESC p` cash-drawer kick). | `packages/receipt-engine/package.json`, `src/escpos/buildEscPos.ts:34` |
| Deploy | Docker Compose (postgres, mock-vsdc, backend, frontend/nginx). Frontend is built with `VITE_API_URL=/api` and nginx proxies `/api/` to the backend, so the SPA is same-origin. Deployed to "Numzlab" by `scripts/deploy-numzlab.sh`. | `smart-pos-frontend/Dockerfile`, `nginx.conf`, `docker-compose.yml` |
| Tenancy | **No tenant/company model.** One `BusinessProfile` singleton + `branchId` (default `"main"`). One deployment = one business. | `grep tenantId\|companyId\|organizationId schema.prisma` → none |
| Existing Electron/desktop code | **None.** (`grep -i electron` only matches the word "Electronics" in a seed category and the guide.) | repo-wide grep |
| Existing offline | One IndexedDB store (`smartpos-till` / `scanEvents`) for the cashier scan journal. No service worker, no PWA, no sale outbox, no idempotency keys. | `src/lib/scanJournal.js`; see `docs/REARCHITECTURE_CASE_STUDY.md` |
| Existing hardware | Network ESC/POS printing **from the backend** (`lib/print/escposSend.js`, TCP :9100) or `window.print()`. No USB, no barcode-specific code (keyboard-wedge only), cash-drawer pulse exists inside ESC/POS builder but only fires when the receipt print opts in. | `routes/printers.js`, `src/lib/printReceipt.js` |

## 2. Startup and build today
* Dev: `npm run frontend` (Vite, :5173) and `npm run backend` (nodemon, :4000) via `dev-helper.js`; or `docker compose up`.
* Prod web: `docker build` → `vite build` with `VITE_API_URL=/api` → static files in nginx (or Caddy) → `/api` proxied.
* API base resolves in `src/lib/apiClient.js` from `VITE_API_URL` **at build time**.

## 3. Integration points the desktop app must respect
1. **API base URL** is compile-time. A shipped installer cannot be rebuilt per customer, so the desktop app needs a *runtime-configurable backend URL*.
2. **Auth**: `POST /api/users/login` → JWT. Token is stored in **both** a `js-cookie` cookie and `localStorage` (`AuthContext.jsx:48-55`); initial React state reads the **cookie only** (`AuthContext.jsx:19`). `apiClient.getAuthToken()` reads cookie then localStorage. 401 → hard redirect `window.location.href = '/login'`.
3. **Routing**: `BrowserRouter` plus absolute `href="/cash-register"` and `window.location.href = '/inventory'`/`'/login'` in several places. These require a real origin with path routing and SPA fallback. **They break under `file://`.**
4. **Printing**: the backend sends ESC/POS to a printer over TCP. A backend running in a data centre or on a home-lab server **cannot reach a printer on the shop's LAN**, so desktop printing must originate on the till PC.
5. **Fiscal states**: `Sale.status` (`PENDING → FISCAL_SUBMITTING → COMPLETED | FISCAL_FAILED`) is server-authoritative. The UI already renders them. The desktop client must not synthesise fiscal success.

## 4. Compatibility issues found
| # | Issue | Impact | Resolution chosen |
|---|---|---|---|
| C1 | `BrowserRouter` + absolute paths | `file://` loading would break navigation and the 401 redirect | Serve the renderer from a **privileged custom scheme** (`numzpos://app/`) with SPA fallback to `index.html`. No router change. |
| C2 | Compile-time `VITE_API_URL` | One installer must work for any backend | Build the renderer exactly as Docker does (`VITE_API_URL=/api`). The **main process proxies `/api/*`** to a configured backend origin, mirroring nginx. The renderer never learns or needs the backend origin and no CORS is involved. |
| C3 | Token in cookie + localStorage (plaintext in the Chromium profile); cookie support on custom schemes is uncertain | Token at rest unprotected; reload could appear logged out | Introduce `src/lib/tokenStore.js`: web behaviour **unchanged**; in desktop the token lives in memory and is persisted with Electron `safeStorage` (OS-backed: DPAPI on Windows) through a narrow IPC. `AuthContext`/`apiClient` call the store instead of touching cookies directly. |
| C4 | Backend printing cannot reach LAN | Receipt/cash-drawer unusable from a remote backend | Local print service in the Electron **main process** (ESC/POS over TCP using the existing `buildEscPosCommands`; Windows driver printing via `webContents.print`). Web behaviour unchanged. |
| C5 | Frontend deps are **not installed on this host**: root `node_modules` lacks tailwind, `@vitejs/plugin-react`, `react-router-dom`, `js-cookie`, `jspdf`, testing-library; `smart-pos-frontend/node_modules` is root-owned and empty (known incident, see project memory). The frontend therefore cannot be built or tested on the host. | Cannot verify "existing frontend tests pass" locally the normal way | Run frontend tests/build in an **isolated Docker copy** (never against live bind mounts); do not touch the broken directory without your decision. |
| C6 | No wine on host | Local Windows packaging needs Wine | Build the installer in the `electronuserland/builder:wine` Docker image, writing only to a scratch directory and the new `desktop/release/`. |
| C7 | `.gitignore` ignores `dist/`, `build/` | Build artefacts never committed (desired) | Keep the installer output under `desktop/release/` (ignored). |

## 5. Security concerns in the existing system (relevant to the desktop client)
* `cors()` is wide open: acceptable behind nginx today, but the backend does not restrict which clients may call it. The desktop proxy helps (single origin) but backend CORS hardening is a separate item.
* Token in `localStorage` + non-HttpOnly cookie: readable by any script in the page. Mitigated in desktop (C3). The web build is unchanged.
* No refresh tokens; 24 h JWT (7 d with remember-me).
* Default seeded credentials (`admin123`/`cashier123`) must never ship as a documented customer default.
* The Express app has no `helmet`/CSP; for the desktop we set our own CSP on the privileged scheme.

## 6. Recommended Electron architecture (the one being implemented)

```
Windows installer (NSIS, electron-builder)
└── NUMZ POS (Electron main process, Node)
    ├── Renderer: existing React build served from numzpos://app/  (sandboxed, contextIsolation, no Node)
    ├── API proxy: numzpos://app/api/*  ──HTTPS──►  configured backend origin (existing Express API)
    ├── Preload: window.numzDesktop = { app, config, secureStore, print, cashDrawer, updates }  (allowlisted IPC)
    └── Services: config, secureStore (safeStorage), printing (system + ESC/POS TCP), updater (electron-updater)
```

* `desktop/` is a **standalone npm package, not a workspace member**. Reason: adding Electron to the root workspace would change the root lockfile used by the backend/frontend Docker builds and risks the `npm ci` node_modules-wipe incident already documented. The desktop package consumes the frontend build output and the receipt-engine CJS build.
* The renderer is **never** remote content. Production loads only bundled assets.
* Web app behaviour is unchanged: every frontend change is guarded by "is the desktop bridge present".

## 7. Scope decisions (honest boundaries)
* **Offline sale queue (Phase Five) is designed, not implemented.** The current backend has no idempotency keys, and `Sale.status` mixes commercial and fiscal state (see `REARCHITECTURE_CASE_STUDY.md` §5.2). A local queue built on that would risk duplicate or mis-labelled sales, which the brief forbids. The prerequisite backend work (idempotent create + fiscal outbox) is documented as the next step.
* **Hardware that cannot be tested here** (thermal printers, cash drawers, USB scanners) is covered by mocks/automated tests and documented as untested on real devices.
* **Code signing and an update feed** need certificates/infrastructure that do not exist in this repo. The updater is implemented, off by default, and never required for the first installer.
* **No tenant/company boundary exists in the schema**, so none can be "preserved" or enforced client-side. The desktop client connects to exactly one backend = one business, and all authorisation stays server-side.

## 8. Baseline test/build results (before any change)
Run in an isolated Docker copy (`node:20`, `npm ci` for the frontend + receipt-engine workspaces, no live
bind mounts touched):

| Check | Result |
|---|---|
| `npm ci` (frontend + receipt-engine) | exit 0 |
| `@smartpos/receipt-engine` build | succeeded |
| Frontend `vitest run` | **8 files, 45 tests passed** |
| Frontend `vite build` with `VITE_API_URL=/api` | **succeeded** (~5.5 s) |
| Backend tests | **not re-run** for the baseline (no backend change is planned; a final regression run is part of the deliverable) |
