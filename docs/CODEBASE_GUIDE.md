# POS CODEBASE GUIDE

> **Purpose of this document**: a persistent architectural map of SmartPOS for future Claude sessions, so the codebase does not need to be rediscovered from scratch each time. Built from a full forensic pass over the actual implementation (not filenames/comments/READMEs alone) on **2026-08-17**, against `main` at commit `932eed6`. **Updated 2026-08-21**, against `main` at commit `36260ba`, to fix drift in the sidebar-navigation and Cashier/POS-screen sections (§3, §15, §25) caused by 11 frontend commits between those two points, plus a second fix for the `ShiftStatus.INITIALIZING` opening-cash-confirmation state (§6, §9.5, §12) added by commit `96681b9` — which predates `932eed6` and so was missed by the original pass entirely, not just made stale by it. §21 still lists the pre-existing gaps found in the original pass, not re-verified in this update pass except where noted. Same pass: retired `STATUS.md` and `smart-pos-backend/docs/ARCHITECTURE.md` (both stale, per §21) — this guide is now the single authoritative architecture/status doc; all repo cross-references were repointed here.
>
> **How to keep this useful**: when you make a structural change (new module, new flow, changed state machine), update the relevant section here in the same session. If you find this doc says something the code no longer does, fix the doc — don't silently work around the discrepancy.
>
> **Other docs that exist and how this one relates to them**:
> - `STATUS.md` (repo root) and `smart-pos-backend/docs/ARCHITECTURE.md` were both **retired 2026-08-21** — both had gone stale (see §21 for the specific false claims found) and everything they covered is now folded into this guide, which is the single authoritative architecture/status reference going forward.
> - [`smart-pos-backend/docs/zra-self-checklist.md`](../smart-pos-backend/docs/zra-self-checklist.md) — the most actively-maintained, evidence-cited ZRA certification checklist. **Treat this as the most current source for ZRA/VSDC compliance status specifically.**
> - This guide is broader than either retired doc: it covers frontend, RBAC, shift/cash reconciliation, purchasing, and reporting in addition to the fiscal core.

---

## 1. System Overview

SmartPOS is a **Zambia ZRA/VSDC-compliant Point-of-Sale platform** — a retail till system (product lookup, cart, checkout, receipts) built around Zambia Revenue Authority's **Smart Invoice / VSDC** e-invoicing mandate. Every completed sale, refund, and debit note must be electronically fiscalized (submitted to a government-mandated device gateway) before it counts as complete; the system enforces this rather than treating it as an optional add-on.

Beyond the till, it covers the operations a small-to-mid retail business needs day to day: inventory with batch/expiry tracking, supplier purchasing (PO → receive → GRN), shift/cash-drawer reconciliation with segregation of duties, configurable role-based access control, audit logging, and reporting.

**Explicitly out of scope** (per project roadmap): AI features, CRM, payroll, HR, advanced analytics, multi-country support, marketplace features, a distinct "register/terminal" concept, suspended sales, credit/account tender, gift vouchers. Each was deliberately rejected as expanding scope without strengthening the core POS/fiscal mission.

**Current maturity**: mock-VSDC-validated. The fiscal pipeline, RBAC, shift/reconciliation, purchasing, and reporting subsystems are built and covered by an extensive test suite running against a real Postgres in CI. **Live ZRA sandbox certification has not been run** — do not describe this system as "ZRA compliant" or "certified" in any user-facing or planning context. See §22 and `zra-self-checklist.md`.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js ≥18, Express 5 |
| ORM / DB | Prisma 6 → PostgreSQL 16 |
| Auth | `jsonwebtoken` (JWT), `bcryptjs` (password + PIN hashing) |
| Backend testing | Vitest 2 + Supertest, run serially against a real Postgres (not mocked) |
| Frontend | React 19 + Vite 7, `react-router-dom` v6 |
| Frontend styling | Tailwind CSS 3 + a small hand-rolled utility-class layer (`panel`, `btn-primary`, etc.) |
| Frontend icons | `lucide-react` (used consistently, no mixed icon libs) |
| Frontend PDF export | `jspdf` + `jspdf-autotable` (dynamically imported to keep out of main bundle) |
| Shared package | `@smartpos/receipt-engine` (TypeScript, npm workspace) — receipt view-model + renderers + ESC/POS builder, consumed by both backend and frontend |
| QR rendering | `qrcode.react` (browser SVG) + native ESC/POS `GS(k` printer command (thermal hardware) |
| Fiscal gateway | Custom HTTP client (`services/vsdcService.js`) + a newer structured gateway (`lib/vsdc-gateway/`) talking to a mock VSDC server in dev/deploy, or a real VSDC/ZRA sandbox/production endpoint via `VSDC_URL`/`VSDC_MODE` |
| Infra | Docker Compose (Postgres, mock-VSDC, backend, frontend/nginx), deployed to a home-lab host ("Numzlab") via `scripts/deploy-numzlab.sh` |
| CI | GitHub Actions — real Postgres service container, full backend test suite, frontend build, Docker build-only smoke test |

**Monorepo**: npm workspaces at the root (`package.json` → `workspaces: ["packages/receipt-engine", "smart-pos-frontend", "smart-pos-backend"]`). There is no lockstep versioning tool; each package has its own `package.json`/scripts, orchestrated by root convenience scripts and `dev-helper.js`.

---

## 3. Repository Map

```
/srv/projects/smartpos/
├── smart-pos-backend/          Express + Prisma API server (port 4000)
│   ├── index.js                 App bootstrap: middleware, route mounting, schedulers
│   ├── routes/                  HTTP layer — one file per resource (23 route modules mounted)
│   │   └── inventory/            Sub-router: core, adjustments, expiry, reports
│   ├── lib/                     Business logic / domain functions (Prisma-transaction-aware)
│   │   ├── print/                 ESC/POS TCP send
│   │   ├── receipt/               Immutable receipt snapshot creation
│   │   └── vsdc-gateway/          Structured VSDC payload builders/validators/transport
│   ├── services/                 ZRA/VSDC clients, audit, item registration/classification
│   ├── middleware/               auth.js (JWT+RBAC), rateLimit.js
│   ├── jobs/                     Standalone CLI wrapper for the fiscal reconciler (cron-style, optional)
│   ├── scripts/                  Ops/validation/migration-adjacent scripts (16 files)
│   ├── prisma/                   schema.prisma (46 models), migrations/ (32), seed.js
│   ├── tests/                    unit/ (33) + integration/ (47) — Vitest, serial, real Postgres
│   ├── mock-vsdc-server.js       Simulates the ZRA VSDC device gateway for dev/CI/deploy
│   └── docs/                     DATABASE.md, implementation-summary.md,
│                                  zra-self-checklist.md (most current compliance doc), VSDC spec PDF
│                                  (ARCHITECTURE.md retired 2026-08-21, superseded by this guide)
├── smart-pos-frontend/          React + Vite SPA (port 5173 dev)
│   └── src/
│       ├── pages/                 Route-level page components (16, most lazy-loaded)
│       ├── components/            Feature folders: cashier/, shifts/, receipt/, products/,
│       │                          inventory/, purchasing/, customers/, suppliers/, users/,
│       │                          audit/, zraSync/, reports/, dashboard/, layout/, auth/, ui/
│       ├── api/ + services/       Two parallel API-client folders (see §5, §19) — both
│       │                          route through lib/apiClient.js
│       ├── contexts/               AuthContext.jsx — the only React Context in the app
│       ├── hooks/                  usePermissions, useDialog, useEndShiftFlow, useMediaQuery,
│       │                          useZraStatus, useOnlineStatus (not an exhaustive list)
│       └── lib/, utils/            apiClient, roleHome, printReceipt, shiftPdf, cartTotals, productUtils
├── packages/receipt-engine/     Shared TS package: ReceiptViewModel, Thermal/A4 React renderers,
│                                  ESC/POS byte builder — imported by both backend and frontend
├── scripts/                     Root-level deploy scripts (deploy-numzlab.sh, etc.)
├── docker-compose.yml            Base 4-service stack (postgres, mock-vsdc, backend, frontend)
├── docker-compose.numzlab.yml    Override for the home-lab deploy target (not a separate stack)
├── vsdc-extracted.txt            Full text of the official ZRA VSDC API spec — ground truth for
│                                  payload/endpoint correctness; cross-check against this, not the mock
└── docs/CODEBASE_GUIDE.md        This document (STATUS.md retired 2026-08-21, superseded by this guide)
```

---

## 4. Architecture

```
smart-pos-frontend (React SPA, :5173)
        │  JWT Bearer + REST (JSON)
        ▼
smart-pos-backend (Express, :4000)
        │
        ├── Prisma → PostgreSQL (single DB, no read replicas / caching layer)
        ├── lib/vsdc-gateway + services/vsdcService.js → VSDC / mock-vsdc-server (:8090)
        └── @smartpos/receipt-engine (shared npm workspace package)
```

**Layering** (backend):

| Layer | Location | Responsibility |
|---|---|---|
| Routes | `routes/*.js` | HTTP, auth guards (`authenticateToken` + `requirePermission`/`requireRole`), request validation, response shaping |
| Services | `services/*.js` | ZRA/VSDC HTTP clients, audit logging, item registration/classification |
| Lib | `lib/*.js` | Core domain logic — sale/refund/shift/inventory/approval state machines, almost always Prisma-transaction-scoped |
| Data | `prisma/schema.prisma` | 46 models, source of truth for all persisted state |

The backend has **no separate "controller" layer distinct from routes** — route handlers call directly into `lib`/`services` functions, which in turn call Prisma. There's no repository abstraction over Prisma; Prisma is used directly throughout `lib`/`services`/`routes`.

**Frontend architecture**: single-page app, one global auth context, no global state library (no Redux/Zustand/Recoil) — feature state lives locally in the component that owns it (e.g., cart state is local to `CashierDashboard`). All network I/O goes through one central `fetch` wrapper (`src/lib/apiClient.js`). See §5 domain map and §15 for the back-office/till split.

**Process model**: one backend Node process runs the Express server *and* three in-process interval-based schedulers (fiscal reconciliation, stock-reservation reconciliation, DB backup) started inside the `app.listen()` callback — see §9. There is no separate worker/queue process; nothing is offloaded to a message queue or background worker service.

---

## 5. Domain/Module Map

| Domain | Backend owner | Frontend owner | Responsibility |
|---|---|---|---|
| **Auth & sessions** | `middleware/auth.js`, `routes/users.js` | `contexts/AuthContext.jsx`, `hooks/usePermissions.js` | Login, JWT verify, permission resolution |
| **RBAC (permissions)** | `lib/permissions.js`, `RolePermission` table | `pages/RolesPage.jsx` | Configurable role→permission matrix |
| **Supervisor approval** | `lib/approval.js`, `routes/tillApprovals.js`, `SupervisorApproval` table | `components/cashier/modern/SupervisorApprovalModal.jsx` | PIN/password-gated authorization for line reversal, discount, shift-end |
| **Till/cart integrity** | `lib/tillLock.js`, `CashierCartSession`/`Line` | `cashier/modern/*` (implicit, via `cashierApi.js`) | Server-committed cart, tamper-check at checkout |
| **Sale/checkout (fiscal)** | `lib/saleFiscal.js`, `services/zraInvoice.js` | `CheckoutModal.jsx` | Stock+registration gates, VSDC submission, completion |
| **Refunds / credit notes** | `lib/saleRefund.js` | `components/sales/RefundModal.jsx` | Partial/full refund, stock restore, VSDC credit note |
| **Debit notes** | `lib/saleDebitNote.js` | `components/sales/DebitNoteModal.jsx` | Value adjustment on a completed sale, no stock movement |
| **Fiscal recovery** | `lib/fiscalReconcile.js`, `lib/fiscalInvoiceNumber.js` | — (ops-only) | Recover stuck submissions, atomic invoice numbering |
| **Shift / cash drawer** | `lib/shift.js`, `lib/cashierDeclaration.js`, `lib/zReport.js`, `lib/shiftAdjustment.js` | `pages/CashRegisterPage.jsx`, `hooks/useEndShiftFlow.js` | Open/operate/end/reconcile, immutable Z-report, decoupled cash count |
| **Discount policy** | `lib/discountPolicy.js`, `BusinessProfile.discountPolicy` | `CartSection.jsx` | Who can apply/request a discount |
| **Inventory** | `lib/inventoryStock.js`, `lib/inventoryAdjust.js`, `routes/inventory/*` | `pages/InventoryPage.jsx` | Stock levels, reservation, adjustment, expiry, batch/FIFO |
| **Bulk import/export** | `lib/inventoryImport.js`, `lib/productImport.js`, `lib/csv.js` | `ProductImportModal.jsx`, `StockTakeImportModal.jsx` | Plan→commit CSV workflows |
| **Purchasing** | `lib/purchasing.js`, `lib/receiving.js`, `lib/supplierReturn.js` | `pages/PurchaseOrdersPage.jsx` | PO lifecycle, GRN receiving, supplier returns |
| **Customers / Suppliers / Categories** | `routes/{customers,suppliers,categories}.js` | corresponding pages | Reference data + ZRA sync (customers/suppliers) |
| **Products / catalog** | `routes/products.js`, `lib/productRegistration.js` | `pages/ProductsPage.jsx` | Catalog CRUD, ZRA classification, VSDC registration gate |
| **Receipts** | `lib/receipt/`, `routes/receipts.js`, `packages/receipt-engine` | `components/receipt/ReceiptViewModal.jsx` | Immutable snapshot, thermal/A4 render, reprint audit |
| **Printing** | `lib/print/escposSend.js`, `routes/printers.js` | `pages/PrintersPage.jsx`, `lib/printReceipt.js` | Network ESC/POS or browser print routing |
| **ZRA/VSDC integration** | `services/{vsdcService,zraInvoice,itemManagement,zraCodesService,itemClassificationService,itemCompositionService}.js`, `lib/vsdc-gateway/`, `routes/{vsdc,zra}.js` | `pages/ZraSyncPage.jsx` | Device init, codes sync, item registration, invoice submission, purchase/import/stock/branch sync |
| **Audit logging** | `services/auditService.js`, `routes/audit.js` | `pages/AuditLogPage.jsx` | Tamper-evident (hashed) event log |
| **Reporting** | `routes/reports.js`, `lib/reports.js` | `components/reports/ReportsPage.jsx`, `components/dashboard/Dashboard.jsx` | Sales/tax/profit/shift/purchase/user-activity/inventory reports |
| **Branches** | `lib/ensureDefaultBranch.js`, `routes/branches.js` | (no dedicated page found) | Multi-branch schema support, single-branch (`main`) in practice |
| **Business profile / settings** | `lib/ensureBusinessProfile.js`, `routes/settings.js` | `pages/SettingsPage.jsx` | Merchant identity, receipt footer, discount policy, backup trigger |
| **Backup** | `lib/backup.js` | — | `pg_dump`-based DB backup, opt-in scheduler |

---

## 6. Data Model

`smart-pos-backend/prisma/schema.prisma` — **46 models, 21 enums**. Grouped conceptually (all groups confirmed to have live call sites except where noted):

### Fiscal transaction models
- **Sale** — core transaction. `status: SaleStatus` (`PENDING → FISCAL_SUBMITTING → COMPLETED | FISCAL_FAILED`; `COMPLETED → REFUNDED` on full refund). Carries the full VSDC response (`rcptNo`, `rcptSign`, `intrlData`, `qrCode`, raw `vsdcRequest`/`vsdcResponse` JSON), `fiscalInvcNo` (unique), `branchId` (default `"main"`), optional `Customer`/`Shift` FK, `discountApprovedByUserId`.
- **SaleItem** — line items with ZRA monetary fields (`splyAmt`, `taxblAmt`, `taxAmt`, `totAmt`) plus **`itemClsCd`/`taxType` frozen at sale time** (deliberate: a later Product reclassification must not retroactively change what an already-submitted or retried sale reports).
- **Refund / RefundItem**, **DebitNote / DebitNoteItem** — same VSDC-field shape and snapshot pattern as Sale/SaleItem.
- **Invoice** — separate legacy ZRA submission audit table. **Write-only in current code**: written by `zraInvoice.js`'s `updateLocalInvoice()`, never read by any route/lib. Data accumulates with no consumer.
- **VsdcDevice** — device registration/keys (`intrlKey`, `signKey`, `cmcKey`, `lastInvcNo` — the shared atomic counter, see §11).
- **ReceiptSnapshot** — frozen receipt JSON, unique per `(sourceType, sourceId)`.

### User / auth / RBAC models
- **User** — `role: Role` (`ADMIN | MANAGER | SUPERVISOR | CASHIER | VIEWER`), `pinHash` (separate bcrypt hash from `password`, nullable), `branchId`.
- **RolePermission** — the configurable RBAC table, `@@unique([role, permission])`. Runtime source of truth for authorization (see §8).
- **SupervisorApproval** — short-lived (3 min), single-use, action-bound authorization ticket (`LINE_REVERSAL | ORDER_DISCOUNT | SHIFT_END`).

### Inventory models
- **Product** — catalog + ZRA classification surface (`zraItemClassification`, `taxType`, `taxRate` default 16%, `vatCategoryCode`), `zraRegistrationStatus: ZraRegistrationStatus` (`PENDING → REGISTERED | FAILED`), `zraItemSnapshot` (read-only reconciliation copy from ZRA, deliberately kept separate from live fields).
- **ProductComposition** — optional BOM/kitting (VSDC spec §6.5).
- **Inventory** — stock per `(productId, branchId)` (unique), `reservedStock` for the pre-deduct hold, low/high-stock flags.
- **InventoryBatch** — batch/expiry tracking, `BatchStatus`, optional `Supplier` FK.
- **StockMovement** — full ledger, `StockMovementType` (13 values incl. `RECONCILED` — ZRA-retrieved, never applied to `currentStock` by design, and `IMPORT_IN` — customs-approval-driven).
- **StockAdjustment** — parallel ZRA-audit-specific adjustment trail (distinct from `StockMovement`).
- **StockRetrievalCursor / ItemRetrievalCursor / PurchaseRetrievalCursor / ImportRetrievalCursor** — four structurally identical one-row-per-branch bookkeeping tables for ZRA pull-sync endpoints, kept separate rather than unified.
- **RetrievedPurchase**, **RetrievedImportItem** — data pulled *from* ZRA. `RetrievedImportItem` carries a local disposition workflow (`ImportItemDecision`: PENDING/APPROVED/REJECTED) feeding `IMPORT_IN` stock movements.

### Shift / cash / reconciliation models (recent redesign, see §12)
- **Shift** — `ShiftStatus` (`INITIALIZING → OPEN → PENDING_RECONCILIATION → CLOSED`; `CLOSED → PENDING_RECONCILIATION` via reopen), `openingFloat`/`countedCash`/`expectedCash`/`variance`. `INITIALIZING` added `2026-08-17` (commit `96681b9`) — see §12.
- **ShiftCashMovement** — `CASH_IN | CASH_OUT | PAID_OUT | SAFE_DROP`, optional witness for safe drops.
- **ZReport** — immutable, generated exactly once at PIN-gated shift-end; no update route exists.
- **CashierDeclaration** — the physical cash count, submitted independently after the Z exists, immutable.
- **ShiftAdjustment** — the only way a recorded variance's story changes after close; additive, never edits the frozen numbers.
- **CashierCartSession / CashierCartLine** — till-lock cart control, explicitly non-fiscal (never touches `SaleStatus`/VSDC).

### Purchasing models
- **Supplier, PurchaseOrder, PurchaseOrderItem, GoodsReceivedNote, GoodsReceivedNoteItem, SupplierReturn, SupplierReturnItem** — full PO→receive→GRN→(optional return) workflow. (Note: an earlier ARCHITECTURE.md claim that purchasing was "not implemented" is stale — this is a complete, tested subsystem.)

### Reference / config / ZRA models
- **Branch**, **BusinessProfile** (singleton, `id:"default"`, also stores `discountPolicy` JSON and `safeDropThreshold`), **Customer** (no loyalty/credit/balance fields — a contact + TPIN record for receipts and ZRA branch-customer sync), **Category** (flat, no hierarchy), **ZraCode / ZraClassificationCode** (synced reference data), **PrinterProfile** (`BROWSER | ESCPOS_NETWORK`, no USB).

### Audit
- **AuditLog** — `hash` field (SHA-256 over key fields) for tamper-evidence, verifiable via `GET /api/audit/verify`.

**Full model-by-model detail, relationships, and field lists**: read `smart-pos-backend/prisma/schema.prisma` directly — it is well-commented and each model above corresponds 1:1 to a section there.

---

## 7. API Map

All routes are mounted in `smart-pos-backend/index.js`, base path `/api`. Every route except `/users/login` and health checks requires `authenticateToken`; most also require a specific permission via `requirePermission`/`requireRole`.

| Route file | Base path | Key endpoints |
|---|---|---|
| `routes/users.js` | `/api/users` | `POST /login`, `GET /profile`, `POST /register`, `PUT /:id`, `POST /:id/reset-password`, `POST /:id/pin`, `POST /:id/zra-sync`, session list/terminate |
| `routes/sales.js` | `/api/sales` | `POST /checkout` (fiscal, primary path), `POST /` (gated pending-only, no VSDC), `POST /:id/fiscalize` (retry), `POST /:id/refund`, `POST /:id/debit-note` |
| `routes/shifts.js` | `/api/shifts` | `POST /open`, `POST /:id/cash-movement`, `POST /:id/end` (approval-gated), `POST /:id/declaration`, `POST /:id/close`, `POST /:id/reopen`, `POST /:id/adjustment`, history/journal reads |
| `routes/tillLock.js` | `/api/till` | `POST /sessions`, `POST /sessions/:id/scan`, `PATCH /sessions/:id/lines/:productId` (reversal, approval-gated), abandon |
| `routes/tillApprovals.js` | `/api/till` | `POST /approvals` (mint ticket), `GET /approvers`, `GET /discount-policy` |
| `routes/products.js` | `/api/products` | CRUD, `/:id/composition`, bulk register, CSV import/export |
| `routes/categories.js` | `/api/categories` | CRUD (delete blocked if products reference it) |
| `routes/inventory/*` | `/api/inventory` | `GET /`, `POST /receive`, `POST /adjust`, `GET /history`, `POST /bulk-adjust`, `GET /expiry-alerts`, `POST /mark-expired`, `GET /export`, `POST /import`, `GET /stock-report`, `/movement-report`, `/value-report` |
| `routes/stock-adjustments.js` | `/api/stock-adjustments` | Read-only history; `POST /` returns `410 Gone` → use `/api/inventory/adjust` |
| `routes/purchaseOrders.js` | `/api/purchase-orders` | Draft/send/cancel/edit, `POST /:id/receive` (creates GRN, auto-fires ZRA purchase sync) |
| `routes/goodsReceivedNotes.js` | `/api/goods-received-notes` | Read-only (GRNs only created via PO receive) |
| `routes/supplierReturns.js` | `/api/supplier-returns` | Create, list |
| `routes/suppliers.js` | `/api/suppliers` | CRUD, `/:id/purchase-history` |
| `routes/customers.js` | `/api/customers` | CRUD, `/zra-lookup`, `/:id/sales-history`, ZRA sync |
| `routes/branches.js` | `/api/branches` | CRUD, `/:id/register-zra` (main branch cannot be deactivated) |
| `routes/receipts.js` | `/api/receipts` | `GET /:sourceType/:sourceId` (sales/refunds/debit-notes), `?reprint=true` |
| `routes/printers.js` | `/api/settings/printers` | CRUD, `GET /status`, `POST /receipt` (ESC/POS send), `POST /:id/test` |
| `routes/settings.js` | `/api/settings` | Business profile CRUD, `GET/PUT /roles*` (RBAC config), `POST /backup` |
| `routes/vsdc.js` | `/api/vsdc` | `GET /status`, `POST /initialize`, `/stock/{sync,retrieve}`, `/items/retrieve`, `/purchases/{sync,retrieve}`, `/imports/{retrieve,:id/decide}`, `/codes/sync`, `/branches/sync` |
| `routes/zra.js` | `/api/zra` | `POST /send-invoice/:saleId`, `GET /receipt-status/:saleId`, `GET /pending-sales`, `POST /bulk-send`, `POST /process-pending` (legacy/ops retry surface) |
| `routes/reports.js` | `/api/reports` | `/summary`, `/weekly`, `/transactions`, `/tax`, `/profit`, `/shifts`, `/purchases`, `/user-activity` |
| `routes/audit.js` | `/api/audit` | List/filter, `GET /verify` (tamper check) |
| `routes/items.js` | `/api/items` | ZRA classification/tax-type/unit code lookups, `/save` (VSDC item push) |

Full request/response shapes: read the route file directly — each is small and self-contained (typically 100–450 lines).

---

## 8. Authentication & Authorization

### Authentication (`middleware/auth.js`, `routes/users.js`)
- **Login**: `POST /api/users/login` (rate-limited, 10 attempts/15min/IP) — email lookup → `isActive` check → `bcrypt.compare` → JWT `{userId, email, role, permissions}`, 24h expiry (7d with `rememberMe`).
- **The JWT's embedded `permissions` claim is a display snapshot only — never trusted for enforcement.** `authenticateToken` re-fetches the user and **re-resolves permissions fresh from the `RolePermission` table on every request**. A permission change via `PUT /api/settings/roles/:role` takes effect on the affected user's very next request, no re-login needed.
- A deactivated user (`isActive: false`) is blocked even with a still-valid unexpired token.
- **Session manager is an in-memory `Map`** — cosmetic bookkeeping only (session list/"terminate" UI). It does **not** invalidate JWTs; a token remains valid until natural expiry regardless of session termination. Lost on server restart, doesn't work across multiple instances.
- **PIN** (`User.pinHash`) is a separate credential, only used for supervisor step-up approval — never for primary login.
- No refresh-token mechanism; tokens simply expire.

### Authorization — two independent systems, do not conflate them

**1. Permission-based RBAC (route/feature access)** — `lib/permissions.js` + `RolePermission` table:
- `DEFAULT_PERMISSIONS` in code is **seed data only**; the runtime source of truth is the DB table, editable by an ADMIN via `PUT /api/settings/roles/:role` and the `RolesPage.jsx` UI (checkbox matrix).
- 60-second in-process cache with synchronous invalidation on write (the cache TTL is a multi-instance safety net, not the mechanism that makes edits "take effect" — that's the synchronous invalidation).
- **ADMIN has no code-level bypass** — every ADMIN permission is an explicit, toggle-able DB row, same as any other role. This is a deliberate design choice (documented in both the schema and `permissions.js`) to avoid a second, unconfigurable authorization model.
- Fine-grained: e.g. `shifts:operate` (any till role) is separate from `shifts:reconcile`/`shifts:viewExpected`/`shifts:viewVariance` (Supervisor+ only) — a Cashier can open/request-end a shift but never see expected cash or variance, or close their own drawer.
- Frontend enforcement is real (nav filtering, route guards, per-button conditional rendering via `usePermissions()`/`canAccess.*`), not merely cosmetic — but the backend independently re-checks everything; frontend gating is defense-in-depth, not the actual boundary.

**2. Rank + PIN-based supervisor approval (specific sensitive actions)** — `lib/approval.js`, `ROLE_RANK` (`VIEWER(0) < CASHIER(1) < SUPERVISOR(2) < MANAGER(3) < ADMIN(4)`), **not affected by RolePermission edits**:
- Three gated actions: **LINE_REVERSAL** (removing/decreasing a scanned till line), **ORDER_DISCOUNT** (when the applicant can't apply directly), **SHIFT_END** (always, no exceptions).
- `requestApproval()` is the *only* place a raw PIN/password is ever checked (bcrypt-compared against `User.pinHash` or `User.password`). Self-approval is **hard-blocked** (`requesterUserId === approverUserId`), not policy-configurable — even an ADMIN cannot self-approve a shift end.
- Approver eligibility: `SUPERVISOR+` rank for LINE_REVERSAL/SHIFT_END; discount-apply-authority (from `discountPolicy`) for ORDER_DISCOUNT — so a Supervisor whose policy flag denies discount-apply still can't approve one, despite outranking a Cashier.
- Produces a `SupervisorApproval` ticket (3-min TTL, single-use, action+target-bound) that the *actual* mutation (`saleFiscal.js`, `tillLock.js`, `shift.js`) consumes atomically inside its own transaction via `consumeApproval()` (row-locked, prevents double-spend).

**Route guard exports**: `requireRole(...)`, `requirePermission(...)`, `requireAllPermissions(...)`, `requireAnyPermission(...)` — all fire a `PERMISSION_DENIED` audit log on rejection.

---

## 9. Core Business Flows

### 9.1 Login
```
LoginForm.jsx → POST /api/users/login → bcrypt.compare → JWT{userId,email,role,permissions}
   → AuthContext stores token in BOTH cookie (js-cookie, 7d) and localStorage
   → GET /api/users/profile hydrates `user` on app mount
```

### 9.2 Checkout (the core fiscal path)
```
CashierDashboard (cart, server-mirrored via till-lock session)
   ↓
CheckoutModal.jsx → checkoutSale() → POST /api/sales/checkout
   ↓
lib/saleFiscal.checkoutSale()
   ├─ createGatedPendingSale()
   │    ├─ assertSufficientStock()        [lib/inventoryStock.js]  — STOCK GATE (row-locked)
   │    ├─ assertRegisteredProducts()     [lib/productRegistration.js] — REGISTRATION GATE
   │    ├─ validateAndLockTillSession()   [if tillSessionId given] — tamper check vs scanned lines
   │    ├─ resolve discount + consumeApproval() if required
   │    └─ createPendingSale()  → Sale(status=PENDING) + SaleItem rows (tax computed, itemClsCd/taxType snapshotted)
   ↓
finalizeSaleFiscally()
   ├─ assertRegisteredProducts() AGAIN (registration may have changed since gate 1)
   ├─ reserveStockForSale()  (row-locked, reservedStock += qty)
   ├─ status → FISCAL_SUBMITTING
   ├─ services/zraInvoice.submitFiscalForSale()
   │    ├─ allocateFiscalInvcNo()  [atomic per-device counter]
   │    └─ lib/vsdc-gateway → payloadBuilders/saveSales.js → endpointAdapter → VSDC/mock
   ├─ VSDC success → completeSaleAfterFiscalSuccess() [ONE transaction]
   │    ├─ Sale.status = COMPLETED, persist rcptNo/qrCode/rcptSign/intrlData
   │    └─ deductStockForSale()  (idempotency-guarded)
   │    then (outside tx, fire-and-forget): stockSyncService push + createSnapshotFromSource('SALE', id)
   └─ VSDC failure → releaseStockReservationForSale() → status = FISCAL_FAILED (fiscalError recorded)
   ↓
CheckoutModal Step 4 → GET /api/receipts/sales/:id → ReceiptViewModel → ThermalRenderer/A4Renderer
   → routeReceiptPrint() → ESC/POS TCP :9100 OR window.print()
```
Bare `POST /api/sales` (no `/checkout`) only runs the gated-pending-create half — no VSDC submission. Use `/checkout` for the real flow.

### 9.3 Refund (credit note)
```
SalesPage → RefundModal → POST /api/sales/:id/refund
   → lib/saleRefund.refundSale()
      ├─ gate: original sale must be COMPLETED with a real rcptNo, not already fully REFUNDED
      ├─ resolveRefundLines()  — partial (explicit items[]) or full (everything outstanding),
      │    tracked cumulatively across multiple partial refunds via getRefundedQtyBySaleItem()
      ├─ createPendingRefund() → finalizeRefundFiscally()
      │    → zraInvoiceService.submitFiscalForRefund()  (rcptTyCd='R')
      │    → on success (ONE tx): Refund.status=COMPLETED + restoreStockForRefund()
      │        (new synthetic batch, RETURN_IN movement, idempotency-guarded)
      │    → markSaleRefundedIfFully() — flips Sale.status=REFUNDED only once every line is
      │        fully covered across all COMPLETED refunds
      └─ createSnapshotFromSource('REFUND', id)
```
**There is no VOID distinct from CANCELLED.** `Sale.status` is never programmatically set to `CANCELLED` anywhere in the codebase (the enum value exists but is dead for Sale specifically — `CANCELLED` *is* used for `PurchaseOrder`). A refund (credit note + stock restore) is the only mechanism for reversing a completed sale.

### 9.4 Debit note
```
SalesPage → DebitNoteModal → POST /api/sales/:id/debit-note
   → lib/saleDebitNote.debitNoteSale()  (rcptTyCd='D', mirrors refund's fiscal-lock pattern)
   → explicitly does NOT move stock (value-adjustment document only)
```

### 9.5 Shift lifecycle (see §12 for full detail)
```
(cashier lands on /cashier, no active shift) ──ensureShiftForLogin() [POST /shifts/ensure]──▶ INITIALIZING
INITIALIZING ──confirmOpeningCash() [POST /shifts/:id/confirm-opening]──▶ OPEN
INITIALIZING ──cancelInitializingShift() [POST /shifts/:id/cancel-initialization, shifts:reopen]──▶ (deleted)
OPEN ──(cash movements: CASH_IN/CASH_OUT/PAID_OUT/SAFE_DROP, unrestricted)──▶ still OPEN
OPEN ──SHIFT_END approval (Supervisor+ PIN, no self-approval)──▶ PENDING_RECONCILIATION
                                                                  + immutable ZReport frozen
PENDING_RECONCILIATION ──cashier submits CashierDeclaration (physical count, immutable)──▶ (same)
PENDING_RECONCILIATION ──closeShift() by a DIFFERENT user, compares declaration vs Z──▶ CLOSED
CLOSED ──reopenShift() [Manager+]──▶ PENDING_RECONCILIATION (never back to OPEN)
CLOSED ──ShiftAdjustment [Supervisor+]──▶ (same, annotates variance, never edits frozen numbers)
```

### 9.6 Purchasing (PO → GRN → stock)
```
DRAFT ──send──▶ SENT ──receiveAgainstPurchaseOrder() (partial, row-locked, one GRN per call)──▶
   PARTIALLY_RECEIVED ──(more receives)──▶ ... ──▶ RECEIVED (terminal)
DRAFT/SENT ──cancel (only if nothing received yet)──▶ CANCELLED

Each receive: receiveStock() [lib/receiving.js] → weighted-avg cost blend, new InventoryBatch,
  PURCHASE_IN StockMovement → (after commit, fire-and-forget) purchaseSaveSync.syncAfterReceive()
  → POST /trnsPurchase/savePurchase to VSDC (ZRA purchase-reporting requirement, item 13*)
```
Supplier returns are a separate, non-fiscal, single-step flow (`lib/supplierReturn.js`) — FIFO-consumes batches, `RETURN_OUT` movement, no VSDC event.

### 9.7 Inventory adjustment / stock-take import
```
InventoryPage → adjust/receive modals → POST /api/inventory/adjust
   → applyStockAdjustment() [lib/inventoryAdjust.js] — writes Inventory + StockMovement +
     StockAdjustment (ZRA audit) + InventoryBatch, atomically, per adjustment

CSV stock-take → plan (validate, no writes) → commit → every changed row routed through
  applyStockAdjustment(auditType:'RECOUNT') — CSV import cannot bypass the ZRA audit trail
```
**No approval gate on stock adjustment** beyond `inventory:write` permission — unlike discount/reversal/shift-end, adjusting stock quantities requires no supervisor sign-off.

### 9.8 Audit logging (cross-cutting)
Almost every write route calls `auditService.safeLog()` — fire-and-forget, never blocks or throws, falls back to a local file if the DB write fails. Produces real before/after diffs (`oldValues`/`newValues`), not just descriptions, plus a SHA-256 integrity hash verifiable via `GET /api/audit/verify`.

---

## 10. Payment Architecture

- **`PaymentMethod` enum**: `CASH | CARD | DIGITAL_WALLET | BANK_TRANSFER` — a **scalar field directly on `Sale`/`Refund`/`DebitNote`**, not a separate `Payment` model. **No split-tender**: exactly one payment method per transaction.
- **No payment gateway/processor integration exists.** For CARD, the till only records `cardLast4` (typed by the cashier); for DIGITAL_WALLET, a phone number string; none of this is sent to any card network or mobile-money API for authorization. **Non-cash payment is fundamentally an honor-system label** — the system trusts the cashier that the payment actually cleared elsewhere. Only `cashReceived`/`change` (cash tender) persist meaningfully onto the Sale.
- **Cash is the only method with real financial consequences inside SmartPOS** — it's the only one that feeds `expectedClosingCash` in shift reconciliation (§12). Card/wallet/bank sales are tracked for reporting but don't affect the cash-drawer math.
- **Two independent ZRA payment-type mapping tables exist** for the same enum (`services/zraInvoice.js`'s `getPaymentType()` and `lib/vsdc-gateway/payloadBuilders/saveSales.js`'s `mapPayment()`) — same intent, different implementation, worth consolidating if ever touched (not urgent, both produce correct output today).
- **Discount interaction**: line discounts reduce the taxable base *before* tax is computed (`taxblAmt = splyAmt − discount; taxAmt = taxblAmt × rate`), matching ZRA's `dcAmt`/`dcRt` model.

---

## 11. Sales Architecture

**State machine** (`SaleStatus`):
```
PENDING → FISCAL_SUBMITTING → COMPLETED → REFUNDED (only on full-refund coverage)
                            ↘ FISCAL_FAILED → (retry) → FISCAL_SUBMITTING → ...
```
- `finalizeSaleFiscally()` only accepts retry from `PENDING`, `FISCAL_FAILED`, or `FISCAL_SUBMITTING` — anything else is rejected.
- **Sequential fiscal invoice numbering** (`lib/fiscalInvoiceNumber.js`): one atomic counter (`VsdcDevice.lastInvcNo`) **shared by Sale, Refund, and DebitNote** — increment is a single atomic Prisma `upsert`, safe under concurrent load. Caveat: each model's `@@unique([fiscalInvcNo])` only protects uniqueness *within* its own table, not across the three tables — the atomic counter is what actually prevents cross-table collision, not the DB constraint.
- **Fiscal reconciliation** (`lib/fiscalReconcile.js`, scheduled every 5 min, only touches records stale ≥10 min): recovers sales/refunds stuck in `FISCAL_SUBMITTING` (checks for an already-received `rcptNo`, then a stored VSDC response, then a live VSDC lookup by invoice number) and sales stuck in `PENDING` (safe blind retry — VSDC was never called). Unrecoverable records land in `FISCAL_FAILED` and need a manual retry (`POST /api/sales/:id/fiscalize` or `POST /api/zra/send-invoice/:id`).
- **Contrast**: `shiftNumber`/`zNumber`/PO/GRN numbers use a weaker **scan-and-increment** helper (`lib/sequentialNumber.js`) with no atomic DB increment and no in-transaction retry — materially weaker than the fiscal counter, acceptable given low concurrency on those sequences but worth knowing if that ever becomes a contention point.

---

## 12. Shift Architecture

This is a recently redesigned subsystem (commit `e38b2c3`, "Z-report/reconciliation redesign") — the core idea is **decoupling the cash count from Z-report generation**, so they're two independent, immutable, sequential facts that are only ever *compared*, never blended. A same-day follow-up (commit `96681b9`, "auto-create shift on cashier login, opening-cash confirmation") replaced the manual "Open Shift" button with an automatic init step gated on a physical cash count — see step 0 below.

```
ShiftStatus: INITIALIZING → OPEN → PENDING_RECONCILIATION → CLOSED
                                                            ↖ reopenShift() [Manager+, lands back in PENDING_RECONCILIATION]
```

0. **Initialize** (`POST /shifts/ensure`, `shifts:operate`) — a cashier landing on `/cashier` with no active shift for their `(userId, branchId)` gets one immediately via `ensureShiftForLogin()`, in status `INITIALIZING`. The till is fully blocked (a non-dismissable `OpeningCashPrompt.jsx`, no tabs/product-grid) until they confirm their physically-counted opening cash via `POST /shifts/:id/confirm-opening` → `confirmOpeningCash()`, which transitions `INITIALIZING → OPEN` and **resets `openedAt` to the confirmation moment** (so shift duration / Z-report timestamps mean "when the till started operating," not idle time before confirming). `POST /shifts/:id/cancel-initialization` (`shifts:reopen`, i.e. Supervisor+) hard-deletes a stuck `INITIALIZING` row — the escape hatch for an abandoned prompt, since nothing else can. Race-safety (double-click, two tabs, retried requests never creating two shifts for one user) is enforced by Postgres itself via a **partial unique index** on `(userId, branchId) WHERE status IN ('OPEN','INITIALIZING')` — this has no `schema.prisma` representation (Prisma has no filtered-unique syntax), so it's invisible to `prisma db push`/migration-history baselining; a loud comment on the `Shift` model plus a dedicated test asserting the index exists via `pg_indexes` are the only things enforcing it stays known. The old manual `POST /shifts/open` route still exists, unremoved — no UI calls it anymore, but many backend tests use it directly as a fixture helper.
1. **Open** (superseded by step 0 for real UI traffic; `POST /shifts/open` still callable directly) — one open/initializing shift per `(userId, branchId)`. Captures `openingFloat` + notes.
2. **Operate** — `recordCashMovement()`: `CASH_IN | CASH_OUT | PAID_OUT | SAFE_DROP`, cashier-initiated, no approval gate, only while `OPEN`.
3. **End** (`POST /shifts/:id/end`) — requires a consumed `SHIFT_END` `SupervisorApproval` (Supervisor+ PIN, **no self-approval ever, hard invariant**). In one transaction: consumes the approval, computes `buildZReportTotals()`, freezes a `ZReport` row (`expectedClosingCash = openingFloat + cashSales − cashRefunds + cashIn − cashOut − paidOut − safeDropsTotal`, counting only `COMPLETED` cash-paid sales/refunds), sets `status = PENDING_RECONCILIATION`. **No update route for `ZReport` exists anywhere** — it is genuinely frozen.
4. **Declare** (`POST /shifts/:id/declaration`) — the shift's own cashier submits `CashierDeclaration` (physical cash count, `declaredTotal` + optional denomination breakdown), independently and after the Z already exists. **Immutable once created**; a wrong count is corrected later only via a `ShiftAdjustment`, never re-submitted.
5. **Close** (`POST /shifts/:id/close`) — the only point the two frozen facts meet: requires the declaration to exist (409 otherwise), computes `variance = declaredTotal − expectedClosingCash`, and **requires the reconciler to be a different user than the shift owner** (`SELF_RECONCILE_DENIED` — even ADMIN can't self-reconcile).
6. **Reopen** (Manager+) — `CLOSED → PENDING_RECONCILIATION`, never back to `OPEN`; cash movements stay locked out.
7. **Adjustment** (`ShiftAdjustment`, Supervisor+) — only on a `CLOSED` shift with an existing `ZReport`; requires `reason` + `resolutionNote`; purely additive, never mutates the frozen `expectedClosingCash`/`declaredTotal`.

**Reporting**: shift/cash reconciliation is folded into `GET /api/reports/shifts`, not a separate "cash report" endpoint.

---

## 13. Inventory Architecture

- **Per-branch stock**: `Inventory` is unique on `(productId, branchId)`. `reservedStock` is a soft hold incremented when a sale enters `PENDING`/`FISCAL_SUBMITTING` and released on completion or failure. `availableUnits() = currentStock − reservedStock` gates new cart additions/PO returns; the *actual sale deduction* deliberately checks raw `currentStock` (not `availableUnits()`) — a documented deliberate choice, since the sale's own reservation is released in the same call.
- **Self-healing reconciliation**: `reconcileReservedStock()` runs on a 5-min scheduler, recomputing `reservedStock` from actual in-flight sale rows and zeroing orphaned reservations — implies the team has previously hit reservation-leak bugs; this is drift correction, not part of the normal lifecycle.
- **FIFO batches**: `deductBatchesFifo()` consumes `InventoryBatch` rows ordered by `expiryDate ASC NULLS LAST, receivedDate ASC, createdAt ASC`, row-locked.
- **Canonical write path**: `lib/inventoryAdjust.js`'s `applyStockAdjustment()` is the intended single function for any non-sale/refund/receipt stock mutation — writes `Inventory` + `StockMovement` + `StockAdjustment` (ZRA audit) + `InventoryBatch` atomically. **Known duplication**: `routes/inventory/adjustments.js`'s `/adjust`, `/history`, `/bulk-adjust` handlers reimplement this logic inline rather than calling the shared function — a drift risk (a fix to one path won't automatically reach the other), and `/bulk-adjust` specifically is missing the batch-create-on-IN step the other two paths have.
- **Bulk import/export**: mature plan→commit CSV workflows (`lib/inventoryImport.js` for stock-take/recount, `lib/productImport.js` for catalog create/update with fuzzy category matching and full ZRA field validation) — not stubs.
- **Multi-branch is schema-real but practically single-branch**: every branch-scoped model defaults `branchId` to `"main"`; no UI/route was found letting a till pick a non-`main` branch during a sale.

---

## 14. Receipt & Invoice Architecture

**`packages/receipt-engine`** — shared TypeScript package, two exports:
- `@smartpos/receipt-engine` — `buildReceiptViewModel()` (pure function, no I/O), `ReceiptViewModel` type (merchant/transaction/items/totals incl. per-rate VAT breakdown/payment/fiscal/customer/footer/receiptMeta blocks), `buildEscPosCommands()`.
- `@smartpos/receipt-engine/react` — `ThermalRenderer`, `A4Renderer`, `ReceiptRenderer` (format switcher). Both renderers emit styled HTML/JSX (not plain text), and both embed a client-side SVG QR code (`qrcode.react`) when `fiscal.qrPayload` is set.

**Snapshot flow**: triggered exactly once, inside the same DB transaction as `status → COMPLETED`, for Sale/Refund/DebitNote alike (`lib/saleFiscal.js`, `lib/saleRefund.js`, `lib/saleDebitNote.js` each call `createSnapshotFromSource()`). Stored as a JSON blob on `ReceiptSnapshot`, unique per `(sourceType, sourceId)`. **"Immutable" is by convention (one call site, one status transition), not by DB constraint** — the write path is an `upsert`, so nothing structurally prevents a second write if a new call site were ever added. Reprints never touch the stored snapshot — they only increment `reprintCount` and return a copy with `isCopy: true`; every reprint fires an audited `RECEIPT_REPRINT` event.

**QR codes**: SmartPOS does not mint the QR payload/URL — it comes straight from the VSDC response (`data.qrCode || data.qrCodeUrl`, e.g. `https://mock.zra.zm/receipt/{invcNo}` in dev) and is persisted verbatim onto `Sale.qrCode`/etc. Two independent renderers turn that same string into an actual scannable code: the browser (`qrcode.react` SVG) and the thermal printer's own firmware (`GS(k` ESC/POS command) — neither fabricates the payload.

**Printing**: two real paths, no USB support.
1. **Network ESC/POS**: `lib/print/escposSend.js` opens a raw TCP socket to a configured `PrinterProfile` (`type: ESCPOS_NETWORK`, `host:port`, default port 9100), writes bytes built by `buildEscPosCommands()`. `POST /api/settings/printers/receipt` is the trigger; `POST /:id/test` sends a synthetic sample.
2. **Browser**: `PrinterProfile.type: BROWSER` short-circuits server involvement entirely — the frontend calls `window.print()` on the rendered receipt DOM.

**Invoice types supported end-to-end**: Sales (S), Credit notes/refunds (R), Debit notes (D), Purchases/GRN (P, separate non-Sale-model flow via `savePurchase.js`). **Commercial/provisional invoices are genuinely not implemented** (zero references anywhere in code or docs).

---

## 15. Back-office Architecture

**Till (cashier-facing)** vs **back-office (management-facing)** is a real, enforced split, not just a UI convention:

- **Global navigation shell** (`components/layout/`): `MainLayout.jsx` is the single router-level layout for every authenticated route, till and back-office alike — it owns `sidebarOpen` state, polls ZRA/VSDC status exactly once for the whole session (`useZraStatus.js`, lifted out of what used to be a per-route poller local to `/cashier` that reset to `checking` on every mount/unmount) and hands the result down through `Outlet` context, and renders a header bar (search + notifications) everywhere *except* `/cashier`, which owns its own bar instead (see Till surface below). The sidebar itself is a grouped-navigation rebuild spread across six files: `Sidebar.jsx` (the shell — desktop rail collapses to a 68px icon-only strip, preference persisted to `localStorage['sidebar:collapsed']` and gated to `lg:` breakpoints via `useMediaQuery.js`; below that breakpoint it's always a full-width slide-over drawer regardless of the persisted preference), `SidebarSection.jsx` (one collapsible accordion group per section, expand/collapse state persisted to `localStorage['sidebar:expandedSections']`, collapses to a header-less icon stack when the rail itself is collapsed), `SidebarNavItem.jsx` (a single link, showing a hover tooltip via `SidebarTooltip.jsx` only when the rail is collapsed to icons), and a footer pairing `SidebarStatus.jsx` (the ZRA VSDC connection dot, same status values the Cashier top bar shows) with `SidebarUserMenu.jsx` (identity + logout). Navigation data lives in `navItems.js` as `DASHBOARD_ITEM` — one ungrouped, role-gated entry sitting above every section (a Cashier never sees it: their only landing route is `/cashier`, per `lib/roleHome.js`, not a hidden-by-permission Dashboard) — plus `NAV_SECTIONS`, six permission-filtered groups (**Operations, Catalog, Supply, Insights, Administration, Compliance**), each rendered as its own `SidebarSection`; a section left with zero visible items after permission filtering renders nothing at all, header included. There is no FINANCE section and no standalone Categories or Analytics nav item — categories are managed inside the Products page rather than getting their own nav destination, and no analytics surface exists beyond Reports.
- **Till surface**: `/cashier` route → `CashierDashboard.jsx`, which owns cart/session state and composes three components from `components/cashier/modern/`:
  - `CashierTopBar.jsx` replaced the old `CashierHeader.jsx` + `CashierTabs.jsx` pair (both deleted) with one 48px bar: a workspace-switcher tab row (**Quick shop / Forecourt / Drafts / Tools** — Forecourt and Drafts are still placeholder panels; Tools holds the actual "Shift & Cash" controls — cash in/out, paid out, safe drop, end-shift request) plus three live status icons (`TopBarStatusIcon.jsx`: receipt printer, network connectivity via `useOnlineStatus.js`, and ZRA VSDC via the same `useZraStatus` value `MainLayout` already polled, received through `Outlet` context rather than re-polled here).
  - `ProductGrid.jsx` uses a **split-scroll layout**, not `position: sticky` — the search/filter row is a plain, always-visible box living outside a separate scrolling container that holds only the card grid. This replaced an earlier sticky-header version that hit a real Chromium bug where scrolled-past grid rows stayed visibly painted above the "stuck" bar instead of clipping under it. The row itself holds a search input, an **availability view** selector (`In Stock` [default] / `All Products` / `Out of Stock` — framed as a view of the catalog rather than a filter the cashier manages, and replacing an earlier plain checkbox), a sort dropdown (name/price/stock), a category **Filter** dropdown, and a live count (`N of M` once the view is hiding results). When the default In Stock view leaves the grid sparse, a trailing note below the results states how many more products are hidden and why (`out of stock or unregistered`), with a one-click link back to the All Products view.
  - `CartSection.jsx` now owns the **Checkout** button directly, pinned inline below the totals inside its own panel — there is no more fixed bottom action bar spanning the screen. Discount controls render only when `discountAllowed` is true (a fail-closed default while the discount policy is still loading).

  Cashiers explicitly never see `expectedCash`/`variance` figures anywhere in this surface (`useEndShiftFlow` only exposes the resulting Z-number to the caller) — segregation of duties is enforced by what data the frontend even receives, not just by permission checks on buttons.
- **Back-office surface**: 14 lazy-loaded pages behind `ProtectedRoute` — Products, Inventory, Purchase Orders (+ GRN + supplier returns tabs), Customers, Suppliers, Users, Roles, Settings, Printers, Audit Log, ZRA Sync, Reports, Sales (history/refund/debit-note), and Cash Register (the manager-side shift console: open/cash-movement/end/declaration/reconciliation/adjustment/reopen — a superset of what the till exposes).
- **All back-office pages are wired to real backend CRUD** — none found to be placeholder-only. The one place with genuinely mixed real/mock data is the **Dashboard** (`/dashboard`, not a back-office "page" per se but the post-login landing screen for non-Cashier roles): today's sales/transaction-count/average-ticket/last-sale are computed live client-side from `GET /sales`; `hourlyStats`, `topProducts`, and `paymentMethods` widgets are hardcoded to empty arrays and never populated, despite their render components being fully built. `ReportsPage` itself (distinct from Dashboard) is **fully real** across all 7 tabs — STATUS.md's "still hardcoded mock data" claim, if read as covering ReportsPage, is stale; it's accurate only for 3 of 6 Dashboard widgets specifically.

---

## 16. External Integrations

| Integration | Purpose | Where |
|---|---|---|
| **ZRA VSDC / Smart Invoice** | Mandatory e-invoicing gateway — sale/refund/debit-note submission, item registration, codes sync, purchase/import/stock/branch pull-sync | `services/vsdcService.js`, `lib/vsdc-gateway/`, `mock-vsdc-server.js` in dev/deploy; real endpoint via `VSDC_URL`/`VSDC_MODE=official` (untested against a live sandbox as of this writing) |
| **Network ESC/POS thermal printers** | Physical receipt printing | `lib/print/escposSend.js` — raw TCP, port 9100 default. No USB/serial support. |
| **Browser print** | Fallback/alternate receipt output | `window.print()` on rendered receipt DOM |
| **PostgreSQL** | Sole datastore — no cache layer (Redis etc.), no read replicas | `lib/prisma.js` |

No payment gateway, SMS/email notification service, or third-party analytics integration exists anywhere in the codebase.

---

## 17. Security Model

- **AuthN**: JWT (HS256 via `jsonwebtoken`, secret from `JWT_SECRET`, validated at boot to reject placeholder/weak secrets), bcrypt password + PIN hashing.
- **AuthZ**: dual-system — configurable DB-backed RBAC for feature/route access (§8), separate rank+PIN supervisor-approval tickets for a small set of high-risk actions (line reversal, discount, shift-end) that are deliberately **not** just permission checks.
- **No global rate limiting** — only `/api/users/login` is rate-limited. No `helmet`-style security-header middleware. CORS is wide open (`cors()` with no config = all origins).
- **Audit trail**: SHA-256-hashed, tamper-verifiable (`GET /api/audit/verify`), broad but not exhaustive coverage (see §21 for known gaps — e.g. `mark-expired` and some ZRA route actions).
- **Trust boundaries**: the backend is the sole enforcement point — frontend RBAC gating is defense-in-depth, never the only guard. Non-cash payment methods are trust-based (no external verification) — this is a deliberate scope boundary, not an oversight, but worth knowing if fraud-prevention work is ever requested.
- **Secrets**: `.env`/`.env.docker.example` hold DB creds, `JWT_SECRET`, VSDC credentials. `scripts/deploy-numzlab.sh` auto-generates a real `JWT_SECRET` via `openssl rand -hex 32` on fresh deploys. Default seeded credentials (`admin@smartpos.com`/`admin123`, `cashier@smartpos.com`/`cashier123`) are **published/documented defaults for dev/demo**, not a leak — but must be rotated before any real production use.

---

## 18. Important Business Rules

- **No sale of an unregistered product**: `assertRegisteredProducts()` blocks checkout (409 `PRODUCTS_NOT_REGISTERED`) for any product not `zraRegistrationStatus: REGISTERED` — checked twice (pending-create and pre-fiscal-submit) since registration state can change between the two.
- **Stock reservation before fiscal commit**: never oversell — stock is reserved at `PENDING`/`FISCAL_SUBMITTING`, only truly deducted on confirmed VSDC success, released on any failure.
- **Tax computed on post-discount base**: line discount reduces the taxable amount before `taxAmt` is calculated.
- **Discount authorization is role/policy-based, not size-based** (a deliberate 2026 redesign, replacing an old "under 10% is free" threshold model — that threshold logic is still computed by `resolveLineDiscount()` but no longer used to gate anything).
- **No self-approval, anywhere, ever** — a user can never approve their own line reversal, discount, or shift end; a shift owner can never reconcile their own shift close. This is a hard invariant, not a permission that could theoretically be granted.
- **ZRA classification/tax fields are snapshotted onto `SaleItem`/`RefundItem`/`DebitNoteItem` at creation time**, not read live from `Product` at submission time — prevents a later product reclassification from silently altering an already-fiscalized or retried transaction.
- **Sale line-item tax/classification fields are frozen**, but **cash movements and stock adjustments require no supervisor approval** — the approval-gating design targets specific high-fraud-risk actions (removing scanned items, discounting, ending a shift), not every mutating action.
- **CSV imports cannot bypass the audit trail** — both stock-take and product-catalog imports route through the same functions (and the same `StockAdjustment`/audit writes) as manual single-record operations.
- **Refunds restore stock into a new synthetic batch**, not the original batch — refunded stock loses its original batch/expiry identity by design.
- **GRN receiving auto-fires ZRA purchase reporting** (fire-and-forget, never blocks or rolls back the receive on VSDC outage) — a deliberate choice to keep purchasing usable even if VSDC is briefly unreachable, with retry available via a manual sync endpoint.
- **The `main` branch can never be deactivated** — hard-coded guard in `routes/branches.js`.

---

## 19. Reusable Capabilities

Before building something new, check whether one of these already does it:

| Need | Reuse this | Not this |
|---|---|---|
| Authenticate an HTTP request | `middleware/auth.js`'s `authenticateToken` + `requirePermission`/`requireRole` | Don't hand-roll JWT verification in a route |
| Check a permission in a route | `requirePermission('resource:action')` | Don't inline `req.user.role === 'ADMIN'` checks |
| Gate a high-risk action behind PIN/password | `lib/approval.js` (`requestApproval`/`consumeApproval`) + a new `SupervisorActionType` if needed | Don't build a parallel PIN-check mechanism |
| Mutate stock outside of a sale/refund/receive | `lib/inventoryAdjust.js`'s `applyStockAdjustment()` | Don't write directly to `Inventory`/`StockMovement` (and don't copy `routes/inventory/adjustments.js`'s inline reimplementation either — that's the thing to fix, not the pattern to follow) |
| Lock and read/write an `Inventory` row safely | `lib/inventoryStock.js`'s `lockInventoryRow`, `reserveStockForSale`, `deductStockForSale`, `restoreStockForRefund`, `deductBatchesFifo` | Don't write ad hoc `SELECT FOR UPDATE` stock logic |
| Submit anything to VSDC | `lib/vsdc-gateway/` (`payloadBuilders/*`, `endpointAdapter`, `transport`) via `services/zraInvoice.js` for sales/refunds/debit-notes, or `services/vsdcService.js` for lower-level device/session/stock calls | Don't call the mock/VSDC HTTP API directly from a route |
| Render or print a receipt | `packages/receipt-engine` (`buildReceiptViewModel`, `ThermalRenderer`/`A4Renderer`/`ReceiptRenderer`, `buildEscPosCommands`) + `lib/receipt/snapshot.js` (backend) or `src/lib/printReceipt.js` (frontend routing) | Don't build a new receipt template |
| Look up/search ZRA classification or code data | `services/zraCodesService.js`, `smart-pos-frontend/src/components/products/ClassificationPicker.jsx` | Don't re-implement code lookups against `ZraCode`/`ZraClassificationCode` |
| Register a product with VSDC | `lib/productRegistration.js` + `services/itemManagement.js` | `services/itemClassificationService.js` is a documented **deprecated compatibility facade** — don't build new code against it |
| Log an auditable event | `services/auditService.js`'s `safeLog()` | Don't `console.log` security-relevant actions |
| Make an authenticated frontend API call | `src/lib/apiClient.js`'s `apiFetch()` | `src/services/api.js` is a **deprecated** re-export shim kept only for old call sites — don't build new code against it |
| Check a permission in the UI | `src/hooks/usePermissions.js`'s `canAccess.*`/`hasPermission()` | Don't re-derive `user.permissions.includes(...)` inline |
| Show a modal | `src/components/ui/Modal.jsx` (+ `useDialog` hook) — accessible, focus-trapped, Escape-to-close | Several older components still hand-roll `fixed inset-0` overlays (`CheckoutModal`, `RefundModal`, `DebitNoteModal`, inline `InventoryPage` modals) — treat these as debt, not a pattern to copy |
| Build a labeled form field | `src/components/ui/Field.jsx` (`TextField`/`TextAreaField`/`SelectField`) — proper `id`/`htmlFor`/`aria-*` wiring | Don't hand-roll `<label>`/`<input>` pairs |
| Format currency | `src/utils/cartTotals.js`'s `formatZmw()` | Several dashboard components still hand-roll `Intl.NumberFormat` calls — don't add a fifth copy |
| End a shift from any UI surface | `src/hooks/useEndShiftFlow.js` | Don't reimplement the approval-ticket dance per page |
| Export a report/journal to PDF | `src/lib/shiftPdf.js` | — |
| Parse/build CSV | `smart-pos-backend/lib/csv.js` (hand-rolled RFC4180-ish, no dependency) | — |

---

## 20. Current State

**Solid and tested** (extensive Vitest coverage against a real Postgres in CI):
- Fiscal checkout/refund/debit-note pipeline, stock reservation/deduction, fiscal reconciliation.
- Configurable RBAC (`RolePermission`) and rank+PIN supervisor approval.
- Shift lifecycle with decoupled Z-report/cash-declaration reconciliation.
- Purchasing (PO → GRN → stock, weighted-average costing, supplier returns).
- Bulk CSV import/export for products and stock-take.
- Reporting: sales/tax/profit/shift/purchase/user-activity/inventory — all real DB-backed queries, all wired to real frontend UI including CSV export.
- Audit logging with tamper-evident hashing, broad (not universal) coverage.
- Receipt engine (thermal/A4 render, ESC/POS print, QR from VSDC response), immutable-by-convention snapshots.
- ZRA/VSDC integration backend: item registration, codes sync, invoice submission (S/R/D), purchase reporting, plus newer sync features — imports, branches, item retrieval, stock retrieval — all backend-complete (§21 covers their missing frontend).

**Frontend**: fully wired for cashier till, purchasing, inventory, customers, suppliers, users, roles, settings, printers, audit log, sales/refund/debit-note. Dashboard is mostly real with 3 static-empty widgets (see §15). No barcode scanner integration exists (text-search-only product lookup).

**Testing**: backend has 80 test files (33 unit + 47 integration) covering fiscal/permissions/inventory/purchasing/shift/audit surfaces broadly. Frontend testing infrastructure is real but thin — 4 test files, all RBAC/navigation-related, no component-level coverage for reports/inventory/purchasing/checkout UI.

**Deployment**: Docker Compose stack (Postgres, mock-VSDC, backend, frontend/nginx), deployed to a home-lab host via `scripts/deploy-numzlab.sh`. Real CI on GitHub Actions (Postgres service container, full test suite, frontend build, Docker build smoke test).

---

## 21. Known Gaps / Technical Debt

**Fiscal-adjacent (higher priority — from `zra-self-checklist.md`, still open as of investigation):**
- **Fiscal signature bug (historical)**: every sale fiscalized before a certain fix had `intrlData` duplicated into the `rcptSign` column instead of the real signature. `scripts/backfill-fiscal-signatures.js` exists to recover the true value from retained `vsdcResponse` JSON but must be run (dry-run by default).
- **Cross-table invoice-number collision**: `Sale`/`Refund`/`DebitNote` share one atomic counter but each has its own independent `@@unique([fiscalInvcNo])` — the per-table constraint alone would not catch a Sale/Refund collision (the atomic counter is what actually prevents it; documented as not fully defense-in-depth).
- **`stockSyncService` routing bug**: one ledger-driven stock-sync caller posts to a hardcoded mock-only path (`/api/stock/save`) instead of going through `endpointAdapter.path(...)` — would target the wrong URL in `official` mode.
- **Mock-vs-reality gap, structural**: the mock VSDC server has previously been built to match *wrong* assumptions about the real ZRA spec (documented, since-fixed instance: tax-type/unit/packaging code numbers), meaning **"passes against mock" has been proven insufficient evidence of real compliance before, and could recur**. Cross-check against `vsdc-extracted.txt` (the real spec text), not just against whether the mock accepts a payload, before trusting a mock-verified claim.

**Backend/data model:**
- **`Invoice` model is write-only** — populated by `zraInvoice.js` on every submission, never read by any route or lib. Dead weight or an intended-but-unbuilt feature (UNKNOWN which).
- **Duplicated adjustment logic**: `routes/inventory/adjustments.js` reimplements `lib/inventoryAdjust.js`'s logic inline instead of calling it; `/bulk-adjust` specifically also skips the batch-create-on-IN step the other two paths perform — a real behavioral inconsistency, not just style debt.
- **`SupplierReturnStatus.CANCELLED`** exists in the enum but no code path ever sets it — returns are always created directly as `COMPLETED`.
- **Stock transfer enum values** (`TRANSFER_IN`/`TRANSFER_OUT` on `StockMovementType`) exist but no dedicated transfer route/lib was found wired up — UNKNOWN whether transfers are handled generically through the adjustment path or are simply unbuilt.
- **Audit coverage gaps**: `POST /api/inventory/mark-expired` mutates stock with no audit call; `routes/items.js`'s `/save` (VSDC item push) has no audit call at the route level; `routes/zra.js`'s invoice-submission/bulk-send endpoints have no audit call visible at the route layer (may be logged deeper inside `saleFiscal.js`/`zraInvoice.js`, not confirmed).
- **`jobs/reconcileFiscal.js`** (standalone cron-style wrapper) is not actually wired to any scheduler in the deployed system — redundant with the in-process 5-minute scheduler in `index.js`; it's a manual escape hatch, not a real second execution path.
- **`ensureDefaultBusinessProfile()`** only sets env-sourced fields (`BUSINESS_TPIN` etc.) on first creation — changing `.env` after first boot has no effect on an existing `BusinessProfile` row without a manual DB edit or `PATCH /api/settings/business`.

**ZRA sync feature UI gap** (backend-complete, no frontend):
Purchase sync/retrieve, import retrieve/decide, branch sync, item retrieval, and stock retrieval all have working backend routes (`routes/vsdc.js`) but **`ZraSyncPage.jsx` only exposes device-init, codes-sync, and a read-only branch snapshot** — an operator can reach these five capabilities only via direct API calls, not through the app. Per the project's own "two-layer definition of done," none of these count as fully ✔️ until the UI layer is built.

**Frontend:**
- **No barcode scanner support** — product lookup is text-search only; a keyboard-wedge scanner would work only by accident (no Enter-to-add handler).
- **Dashboard has 3 permanently-empty widgets** (`hourlyStats`, `topProducts`, `paymentMethods`) whose render components are fully built but never fed data — the backend report endpoints they'd need largely already exist (`fetchWeeklyReport`/`fetchReportSummary`), so this looks like a small follow-up rather than new subsystem work.
- **No shared debounce hook** — hand-rolled per call site in ~5 places (customer/supplier search, `ProductPicker`, `ClassificationPicker`).
- **No toast/notification system** — `alert()`, ad hoc inline banners, and per-page state are used interchangeably for error/success messaging.
- **`framer-motion` dependency has zero usages** in `src/` — dead weight in the frontend bundle.
- **Two parallel API-client folders** (`src/api/` and `src/services/`) with no consistent rule for which new code should use — both ultimately route through `apiFetch`, so it's an organizational inconsistency, not a functional risk. `src/services/cashierService.js` is a dead empty file.
- **Modal accessibility is inconsistent**: `ui/Modal.jsx` (focus-trapped, Escape-to-close, ARIA-correct) is used by ~22 modals, but `CheckoutModal`, `RefundModal`, `DebitNoteModal`, `ShiftTransactionJournal`, and a few inline modals in `InventoryPage`/`CashRegisterPage` still hand-roll overlay markup without that treatment.
- **No pagination on most list pages** — `ui/Pagination.jsx` is used only by `AuditLogPage`; other list pages (customers, products, sales) fetch the full dataset and filter client-side, a scale concern as data grows.

**Documentation staleness caught during this investigation** (now superseded by this guide, but worth knowing the pattern recurs): `STATUS.md` and `smart-pos-backend/docs/ARCHITECTURE.md` both claimed purchasing/imports/branch-sync/item-retrieval/stock-retrieval were "deferred/not implemented" — all five were actually built between 2026-08-12 and 2026-08-14, evidenced only in the more actively maintained `zra-self-checklist.md`. **Lesson**: for ZRA/VSDC compliance status specifically, trust `zra-self-checklist.md` over the other two; for everything else, verify against code rather than any status doc, including this one, once enough time has passed.

---

## 22. Target State

Where the code's own comments/structure indicate clear direction (not speculation):

- **ZRA certification path**: the self-checklist frames a specific sequence — backend build → mock verification → **live ZRA sandbox smoke test** (`scripts/sandbox-smoke.js`, `VSDC_MODE=official`) → certification → production rollout. Sandbox credentials (TPIN, licence number) are explicitly the one remaining blocker per project memory — a business/registration step, not a code gap.
- **Two-layer "definition of done"** (documented in `zra-self-checklist.md`): a checklist item isn't ✔️ until both backend evidence (spec cross-check, endpoint, request/response, persistence, error handling, tests, live verification) *and* UI evidence (exists, accessible, permissioned, correct data, actionable, proper loading/success/error states, backend-result reflected, end-to-end browser-verified) are met. This is why the five backend-complete-but-UI-missing ZRA sync features (§21) are correctly *not* being called done — the project holds itself to a stricter bar than "the API works."
- **RBAC redesign trajectory**: the shift from hardcoded role checks to a fully configurable `RolePermission` table (with no ADMIN bypass) is complete, not in-progress — this is current state, listed here only to note it as the *direction* the project was moving in and has now reached.
- **Reconciliation redesign trajectory**: likewise, the shift/Z-report/cash-declaration decoupling is a completed redesign (not aspirational) — described in detail in §12.

**Roadmap phases** (from project memory, user's own 6-phase plan — sequence is: correctness → operations → business workflows → insights → polish → certification): phases 1–4 (core stabilization, essential retail ops, business/purchasing management, reporting) are done. Phase 5 (polish: mobile responsiveness, accessibility further passes, performance, bulk import/export UX) is partially done (accessibility pass completed; performance/mobile-specific work and the modal-consistency gap in §21 remain open). Phase 6 (ZRA certification) is code-complete per the self-checklist's own accounting except for live sandbox credentials.

---

## 23. Architectural Decisions

Established, intentional choices — do not "fix" these without understanding why they were made first:

- **No separate VOID status** — a refund is the only reversal mechanism for a completed sale; `CANCELLED` exists in the schema but is dead for `Sale` specifically (deliberate, per project memory: "no data model backs" a distinct void concept cleanly).
- **No suspended sales, register/terminal concept, credit/account tender, or gift vouchers** — deliberately omitted; each "expands scope without strengthening the core POS" (project memory, direct quote).
- **Discount authorization is role/policy-based, not percentage-threshold-based** — a deliberate replacement of an earlier "under 10% is free" model; the old threshold-calculation code path (`resolveLineDiscount`'s `requiresApproval` output) is retained but explicitly retired from actually gating anything.
- **ADMIN has no authorization bypass** — every permission, including ADMIN's, is a real toggle-able `RolePermission` row, to avoid maintaining two authorization models (one configurable, one hardcoded-privileged).
- **Self-approval is structurally impossible**, not merely discouraged — enforced at the code level for line reversal, discount, shift-end, and shift-close-reconciliation, with no configuration flag to relax it.
- **Cash-count and Z-report generation are decoupled by design** — a physical cash count never influences the frozen expected-cash figure, and the frozen figure is computed before any count happens; the two are only ever compared, never blended, and always by different users.
- **Sale-time snapshotting of tax/classification fields onto line items** — a later Product edit must never retroactively change what an already-submitted (or retried) sale reports to ZRA.
- **GRN receiving fires ZRA purchase reporting asynchronously and non-blockingly** — a receive should never fail or roll back because VSDC happens to be down; sync gaps are retryable later, not silently ignored (persisted `zraSyncedAt`/`lastSyncError` fields make gaps visible).
- **Discounts don't get redistributed into VSDC item-level fields** — order-level discount is submitted as a distinct `cashDcAmt`/`cashDcRt` residual rather than being algebraically pushed down into each item, deliberately matching the ZRA spec's own worked example rather than a simpler-but-non-compliant approach.
- **Network ESC/POS + browser print only, no USB** — the printer integration surface is deliberately scoped to what a small retail deployment actually needs.
- **Single shared PostgreSQL instance, no cache layer, no message queue** — background work is handled via in-process interval schedulers inside the one Express process, not a separate worker service; consistent with a single-instance small-business deployment target (Numzlab home-lab), not a horizontally-scaled SaaS architecture.

---

## 24. Open Questions

Things that could not be confidently determined from the repository alone — verify before relying on them:

- **`Invoice` model's intended purpose**: is it meant to be surfaced somewhere (a planned admin view?) or is it genuinely dead code that should eventually be removed? UNKNOWN — no route/lib reads it anywhere found.
- **Stock transfer capability**: do `TRANSFER_IN`/`TRANSFER_OUT` enum values represent a real, reachable feature (perhaps folded generically into the adjustment path) or an unbuilt placeholder? Not exhaustively verified — worth a targeted grep before assuming either way.
- **Whether `SupplierReturnStatus.CANCELLED` is intentionally unreachable** (returns are simple/instant by design, so cancellation may not be a meaningful concept) or a genuinely missing feature. UNKNOWN — no explicit design note found either way.
- **Session-file persistence under Docker**: `services/vsdcService.js` persists VSDC session state to `tmp/vsdc-session.json` for process-restart recovery — UNKNOWN whether this path is on a persistent volume in the Docker/Numzlab deployment or ephemeral container filesystem (if ephemeral, the recovery mechanism is a no-op in practice on redeploy).
- **Live ZRA sandbox behavior**: everything about how the real ZRA VSDC endpoint responds (error shapes, timing, rate limits, edge cases in the spec not exercised by the mock) is unverified — the mock has been wrong before (§21) and could be wrong again in ways not yet discovered.
- **Whether `RolePermission` cache invalidation is reliable across multiple backend instances**: the code's own comments frame the 60s TTL as a "safety net for multi-instance staleness," implying multi-instance deployment isn't the primary target today (single Numzlab container) — but if horizontal scaling is ever introduced, verify this actually behaves correctly under it.

---

## 25. Quick Reference

**"I need to touch..."**

| ...this concept | Start here |
|---|---|
| Checkout / fiscal submission | `smart-pos-backend/lib/saleFiscal.js`, `services/zraInvoice.js` |
| Refunds / credit notes | `smart-pos-backend/lib/saleRefund.js` |
| Debit notes | `smart-pos-backend/lib/saleDebitNote.js` |
| Stock reserve/deduct/restore | `smart-pos-backend/lib/inventoryStock.js` |
| Stock adjustment (manual/CSV) | `smart-pos-backend/lib/inventoryAdjust.js` (canonical — not `routes/inventory/adjustments.js`'s inline copy) |
| Shift open/end/close/reconcile | `smart-pos-backend/lib/shift.js`, `lib/cashierDeclaration.js`, `lib/zReport.js`, `lib/shiftAdjustment.js` |
| Supervisor PIN approval | `smart-pos-backend/lib/approval.js`, `routes/tillApprovals.js` |
| Till/cart tamper-check | `smart-pos-backend/lib/tillLock.js` |
| Discount rules | `smart-pos-backend/lib/discountPolicy.js` |
| RBAC / permissions | `smart-pos-backend/lib/permissions.js`, `middleware/auth.js`, frontend `src/hooks/usePermissions.js` |
| Purchasing (PO/GRN/returns) | `smart-pos-backend/lib/purchasing.js`, `lib/receiving.js`, `lib/supplierReturn.js` |
| VSDC/ZRA submission internals | `smart-pos-backend/lib/vsdc-gateway/`, `services/vsdcService.js`, `services/zraInvoice.js` |
| Product ZRA registration | `smart-pos-backend/lib/productRegistration.js`, `services/itemManagement.js` |
| Receipts (generate/render/print) | `packages/receipt-engine/src/`, `smart-pos-backend/lib/receipt/`, frontend `src/lib/printReceipt.js` |
| Audit logging | `smart-pos-backend/services/auditService.js` |
| Reports | `smart-pos-backend/lib/reports.js`, `routes/reports.js`, frontend `src/components/reports/` |
| Database schema | `smart-pos-backend/prisma/schema.prisma` |
| App bootstrap / schedulers | `smart-pos-backend/index.js` |
| Cashier till UI | `smart-pos-frontend/src/components/cashier/modern/CashierDashboard.jsx` (+ `CashierTopBar.jsx`, `ProductGrid.jsx`, `CartSection.jsx` in the same folder) |
| Checkout UI | `smart-pos-frontend/src/components/CheckoutModal.jsx` |
| Shift/reconciliation UI | `smart-pos-frontend/src/pages/CashRegisterPage.jsx` |
| Global sidebar / nav structure | `smart-pos-frontend/src/components/layout/Sidebar.jsx`, `navItems.js`, `MainLayout.jsx` |
| Frontend API client | `smart-pos-frontend/src/lib/apiClient.js` |
| Frontend auth state | `smart-pos-frontend/src/contexts/AuthContext.jsx` |
| Deployment | `scripts/deploy-numzlab.sh`, `docker-compose.yml` + `docker-compose.numzlab.yml` |
| Ground-truth ZRA spec | `vsdc-extracted.txt` (repo root) — cross-check against this, not the mock server, for real compliance questions |
| Most current compliance status | `smart-pos-backend/docs/zra-self-checklist.md` |
