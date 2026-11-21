# NUMZ POS: Offline Design Proposal

> **Status: Phase 1 BUILT (2026-11-21, uncommitted at time of writing); Phases 2-5 are still PROPOSAL.**
> Written against `main` @ `7bd9060`.
>
> **Phase 1 delivered (L0 "survive blips"), all frontend:** `apiFetch` now classifies errors (`ApiError.kind` =
> `auth | network | business`, new `NetworkError`, optional `timeoutMs`); `lib/connectivity.js` tracks real server
> reachability (heartbeat + every API call; UNKNOWN/ONLINE/DEGRADED/OFFLINE) and `useOnlineStatus` now means "our
> server is reachable"; `AuthContext` no longer signs a user out or discards the token when the server is merely
> unreachable, restores a saved session (desktop: OS-encrypted `auth.session`; only if the JWT is unexpired **and** was
> issued to that same user id) and re-validates it automatically when the server answers (a 401 then signs out);
> `ConnectionBanner` tells the truth (cannot complete sales offline, cart kept); the login form re-enables itself when the
> server returns; checkout refuses to send while the server is known to be down and, if the link drops mid-sale, tells the
> cashier **not to charge again until they check Sales** (there is still no sale-level idempotency key).
> **Not covered by Phase 1:** selling offline in any form, and the web build keeps the saved session in memory only
> (a browser reload while offline still needs the server). Persisting the saved session across an app restart relies on
> Electron `safeStorage` (Windows DPAPI): unit-tested with a fake bridge, but **not exercised end-to-end** (the headless
> Linux test machine has no OS keyring) and not tried on real Windows.
> Builds on [REARCHITECTURE_CASE_STUDY.md](./REARCHITECTURE_CASE_STUDY.md) (the "why") and
> [DESKTOP.md](./DESKTOP.md) (the desktop shell). Code facts below were checked in the repo; anything not
> checked is marked **UNVERIFIED**. Decisions that need the owner are collected in §9.

## 1. The question and the honest starting point

*"How offline can this system work?"* Today: **almost not at all.**

| Fact (verified in code) | Consequence |
|---|---|
| `AuthContext.jsx:30` calls `logout()` when the startup profile check fails for **any** reason, including "no network" | Reopening the app offline signs the user out. |
| `LoginForm.jsx` disables sign-in when `/api/health` fails | They cannot sign back in. Offline cold start is a dead end. |
| Products, prices and stock are fetched live (`cashierApi.fetchProducts` → `/products`); nothing is cached | The till has no catalogue without the server. |
| `finalizeSaleFiscally` throws 503 if VSDC cannot be initialised (`saleFiscal.js:494`); checkout completes **only** on VSDC success | No ZRA, no sale. `BusinessProfile.zraEnabled` only hides fiscal blocks on receipts. |
| There is **no sale-level idempotency key** (`grep idempotencyKey\|clientTxnId` finds none in `lib/`, `routes/`, schema). Only scans are idempotent (`CashierCartLine @@unique([sessionId, clientScanId])`, `lib/tillLock.js:49-110`) | A naive "retry the checkout" would double-sell. |
| `useOnlineStatus` reads `navigator.onLine` | It says "online" whenever the PC has a network, even if our server is unreachable. |

What **already helps** (reuse, don't rebuild):

* The scan pipeline is already offline-shaped: a client-generated `localTxnId`, a durable IndexedDB journal
  (`lib/scanJournal.js`), single-consumer ordering, background `syncScan` with `clientScanId` idempotency.
* `@smartpos/receipt-engine` already models `FiscalMode = 'ONLINE' | 'OFFLINE'` and
  `FiscalSubmissionStatus = 'SUBMITTED' | 'PENDING' | 'FAILED'` (`types.ts`), so a provisional receipt needs no new template concept.
* Atomic server-side fiscal invoice numbering (`VsdcDevice.lastInvcNo`) and a stuck-submission reconciler (`fiscalReconcile.js`).
* The desktop shell (local printing, secure storage, runtime server address) and a Docker stack that can run on a shop PC.

## 2. What "offline" will mean: four levels, each shippable alone

| Level | Promise | Needs |
|---|---|---|
| **L0. Survive blips** | A dropped connection never loses a cart, never signs the user out, and the screen says so plainly. Retries automatically. | Phase 1 |
| **L1. Shop keeps selling without internet** | Internet down, shop LAN up: tills keep selling against a **shop-local server**. | Phase 2 (+ shop PC) |
| **L2. Till keeps selling without the shop server** | Wi-Fi/server hiccup: the till queues completed sales locally and syncs later, **no duplicates**. | Phases 3-4 |
| **L3. Sell now, fiscalise later** | With ZRA mode on and ZRA unreachable, sell with a provisional receipt and sign later. | Phase 5 **and written ZRA confirmation** |

Each level includes the one before. "Completely offline" in the strict sense means L2 with ZRA mode **off**.

## 3. Principles (the rules the design must not break)

1. **The server stays the single source of truth.** The till keeps a *cache* and an *outbox*, never a second ledger.
2. **Every write carries a client-generated UUID** that the server uses as an idempotency key. Replays return the original result.
3. **Nothing is silently dropped.** A failed sync stays visible until a person resolves it. No auto-delete.
4. **The client never invents fiscal data.** No `rcptNo`, signature or QR is produced locally. A sale is "fiscalised" only after a real VSDC confirmation (this is also a standing project rule).
5. **Honest labelling.** Offline receipts say PROVISIONAL; the UI always shows connection state, queue size and age.
6. **Offline permissions are bounded.** Anything that needs a second person's approval or reconciliation is *disabled* offline (§6).
7. **Additive migrations only.** Existing columns/semantics stay; new nullable columns and a compatibility period.

## 4. Architecture

```
 TILL (desktop app / browser)                           SHOP SERVER (authoritative)                CLOUD / ZRA (optional)
 ───────────────────────────                            ─────────────────────────                  ─────────────────────
 connectivity monitor ── heartbeat /api/health ───────► Express + Prisma + Postgres  ──fiscal outbox──► VSDC / ZRA
 session cache (user, permissions, exp)                 idempotent checkout                         (retry w/ backoff)
 read cache (IndexedDB): products, tax, policy          sale + fiscalStatus (separate)
 order outbox (IndexedDB): LOCAL→SYNCING→SYNCED|REJECTED  fiscalMode: OFF | ONLINE_REQUIRED | DEFERRED
 provisional receipts (local numbering)                 sync audit (clientCreatedAt / syncedAt)
```

### 4.1 Connectivity monitor (Phase 1)
Replace `navigator.onLine` with a real **server-reachability** signal: `GET /api/health` every ~10 s (backoff when down),
plus request failures observed by `apiFetch`. States: `ONLINE`, `DEGRADED` (slow/intermittent), `OFFLINE`.
`apiFetch` classifies errors: **`kind: 'network'`** (fetch rejected / timeout / 502-504) vs **`kind: 'auth'`** (401) vs **`kind: 'business'`** (4xx/422).
Only `auth` may log a user out. One shared store feeds the top-bar status icon and the proposed always-visible system strip.

### 4.2 Offline session (Phase 1)
* On login, cache `{ user, permissions, role, branchId, tokenExp }` (desktop: encrypted with `safeStorage`; browser: memory only, so the web build stays online-first).
* Cold start with an unreachable server and an **unexpired JWT**: restore the cached session, mark it `offline-session`, and re-validate against `/users/profile` as soon as the server answers. A 401 then signs out as today.
* Trade-off (accepted, bounded): a user deactivated or demoted while the till is offline keeps their old rights until reconnect, at most until the JWT expires (24 h; 7 d with remember-me, which should be disabled for tills, **Decision D4**).

### 4.3 Read cache (Phase 3)
IndexedDB stores, refreshed on sign-in and every ~5 min while online (delta by `updatedAt` once an endpoint exists; full refresh is acceptable first):
`products` (price, barcode, tax class, ZRA registration status, stock snapshot + `fetchedAt`), `categories`, `discountPolicy`, `businessProfile`, `openShift`, `printerConfig`.
Offline stock rule: **sell against cached stock minus locally-sold units**, warn at zero, and allow overselling only if the owner enables it (**D6**). Products not ZRA-registered stay blocked when fiscal mode needs registration (same gate as online).

### 4.4 Order outbox (Phase 4, needs Phase 2's server work)
A completed sale becomes one durable record keyed by the existing `localTxnId`: lines (with the **tax/classification snapshot** the server also freezes), computed totals (shared `cartTotals`), tender, cashier, `shiftId`, `createdAt`, `status`.
`LOCAL → SYNCING → SYNCED | REJECTED(reason)`; survives crash/restart; synced strictly in `createdAt` order.
Server: `POST /api/sales/checkout` accepts `idempotencyKey` (= `localTxnId`) and `clientCreatedAt`. New nullable `Sale.idempotencyKey @unique`; a repeat returns the **original** sale (200, same body) instead of creating another.
Server re-validates at sync (stock gate, registration gate, shift still open) and records `clientCreatedAt` vs `syncedAt` in audit.
Reasons a sale can be `REJECTED`: product deleted/unregistered, stock insufficient (if oversell off), shift already closed, price drift beyond policy. Rejections go to a **"Needs attention"** list for a manager; options: accept with stock adjustment, or reverse via refund/credit note (there is deliberately no VOID).

### 4.5 Fiscal separation on the server (Phase 2)
Today one field mixes commercial and fiscal truth (`Sale.status`: `PENDING → FISCAL_SUBMITTING → COMPLETED | FISCAL_FAILED`).
Add an **independent** `Sale.fiscalStatus` (`NOT_REQUIRED | PENDING | SUBMITTING | FISCALIZED | FAILED`), the pattern the Forecourt module already uses, and a business-level `fiscalMode`:

| `fiscalMode` | Sale completes when… | ZRA unreachable | Receipt |
|---|---|---|---|
| `OFF` | tender is taken | irrelevant, never called | final, non-fiscal, labelled as such |
| `ONLINE_REQUIRED` (today, **default**) | VSDC confirms | cart is **parked**, cashier keeps serving | fiscal |
| `DEFERRED` (only after ZRA OK) | tender is taken | sale stands, `fiscalStatus=PENDING`, outbox retries with backoff | PROVISIONAL, then fiscal reprint |

Compatibility: backfill `COMPLETED → fiscalStatus=FISCALIZED`; keep `status=COMPLETED` meaning "commercially complete". **Every reader of "COMPLETED" must be audited** (reports, Z-report cash maths, refunds' "needs real `rcptNo`" gate in `saleRefund.js`, receipt loaders, reconciler). This audit is the main cost and risk of the project; hence a compatibility view and a feature flag.
`BusinessProfile.zraEnabled` (display-only today) is renamed/superseded by `fiscalMode` to remove its misleading name.

### 4.6 Provisional receipts (Phase 4)
Local numbering `P-<tillCode>-<seq>` (monotonic per till, stored durably), receipt-engine `fiscal.mode = 'OFFLINE'`, `submissionStatus = 'PENDING'`, banner "PROVISIONAL, fiscal receipt to follow". After sync the real receipt is available for reprint; the provisional number is stored against the sale for lookup. In `OFF` mode the receipt is final and carries no fiscal block.

### 4.7 Shop-local server and failover (Phase 2)
The existing Docker stack runs on a shop PC; the desktop app is pointed at it (`http://192.168.x.x:4000`, already allowed by the address policy).
Proposed small addition: the desktop config holds an **ordered list** of server addresses (LAN first, public second) and the proxy uses the first that answers `/api/health`, re-checking periodically. Data between a shop server and the public server is **not** synchronised in this proposal (**D3**): each shop is its own deployment.

## 5. What works in each state

| Capability | Online | Offline, shop server up (L1) | Till isolated (L2) | ZRA down, mode ONLINE_REQUIRED |
|---|---|---|---|---|
| Sign in (cached session) | yes | yes | **yes (cached, Phase 1)** | yes |
| Scan / cart | yes | yes | yes (local catalogue) | yes |
| Sale, mode `OFF` | yes | yes | **queued → synced** | n/a |
| Sale, mode `ONLINE_REQUIRED` | yes, fiscal | only if VSDC reachable from shop | **not allowed** (no fiscal confirmation possible) → park cart | parked |
| Sale, mode `DEFERRED` | yes | yes, provisional | queued, provisional | yes, provisional |
| Cash in/out, safe drop | yes | yes | queued | yes |
| Supervisor approvals (discount, line reversal) | yes | yes (server-side PIN) | **disabled** | yes |
| Refund / debit note | yes | yes | **disabled** (needs original fiscal data) | disabled for unfiscalised sales |
| End shift / Z-report / reconcile | yes | yes | **blocked while outbox non-empty** | yes |
| Receipt printing (LAN printer) | yes | yes | yes | yes |
| Reports, inventory admin, purchasing | yes | yes | disabled | yes |

Rule that protects the drawer: **a shift cannot end while any of its sales are still unsynced**, because expected cash is computed from synced `COMPLETED` cash sales.

## 6. Security of offline data
* Orders contain no card numbers (only a typed last-4); they may contain customer names/TPIN. Desktop: encrypt outbox payloads with an AES-GCM key held via `safeStorage` (no plaintext fallback, same stance as the token). Browser build: outbox disabled (online-first) unless the owner explicitly accepts storage in the browser profile (**D7**).
* Offline approvals are disabled in v1 rather than caching approver PIN hashes (a stolen till would then allow offline brute force).
* Sync endpoints enforce the same RBAC and branch scoping as online checkout; the server never trusts client totals, tax or discount authority beyond what the existing gates validate.
* Replays after token expiry: the outbox keeps orders; a manager signs in to flush them (the user who created them is recorded from the order, not from whoever flushes, **D8**).

## 7. Phased plan (each phase ships and is testable alone)

| # | Phase | Delivers | Size | Depends on |
|---|---|---|---|---|
| 1 | **Resilient session + connectivity** | L0: no logout on network errors, offline session restore, real reachability signal, status strip with queue placeholder, `apiFetch` error kinds | **S-M**, frontend only | none |
| 2 | **Fiscal separation + modes** | `fiscalStatus`, `fiscalMode OFF/ONLINE_REQUIRED`, park-cart, fiscal outbox worker, COMPLETED-reader audit, shop-server deployment guide + LAN failover list | **L**, backend heavy, highest risk | Phase 1 optional |
| 3 | **Read cache** | catalogue/policy cache, offline cart against cache, stale indicators | **M** | 1 |
| 4 | **Order outbox + idempotent checkout** | L2: durable outbox, `idempotencyKey`, provisional receipts, Needs-attention list, shift-end block | **L** | 2, 3 |
| 5 | **Deferred fiscalisation** | `DEFERRED` mode, fiscal reprint, deadline countdown | **M** | 2, 4 **+ ZRA confirmation** |

Suggested order: **1 → 2 → 3 → 4**, then 5 only when permitted. Phase 1 alone fixes the "app useless after an internet blip" problem.

## 8. Testing strategy (defined before building)
* **Unit:** error classification, session restore rules, outbox state machine, idempotency (same key twice → one sale), provisional numbering monotonicity, tax/total parity with the server calculation.
* **Integration (backend, real Postgres):** replay storms, concurrent replays of the same key, out-of-order arrival, rejection reasons, `fiscalStatus` transitions, Z-report parity before/after the `COMPLETED` audit.
* **Fault injection in the real desktop app** (extend the existing Playwright-Electron smoke test): kill/restore the fake backend mid-sale, restart the app with items in the outbox, corrupt a stored order, expire the token while queued.
* **Chaos soak:** a script that drops the network at random while sales flow, then asserts "sales sent = sales stored, zero duplicates, zero lost".
* **Money invariants as tests:** expected cash after sync equals cash tendered; no sale is ever `FISCALIZED` without a stored VSDC response.

## 9. Decisions needed from the owner

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Ask ZRA in writing whether a provisional receipt + later signing is permitted (Phase 5)? | Yes, start now; ship Phases 1-4 meanwhile. |
| **D2** | Until D1: when ZRA is down in `ONLINE_REQUIRED`, **park** the cart or block checkout? | Park. |
| **D3** | One server per shop (own database), or one shared central server? | Per-shop for offline; central only for reporting later (needs a separate sync design). |
| **D4** | Disable "remember me" (7-day token) on tills? | Yes: tills use 24 h tokens. |
| **D5** | Is a shop-local server acceptable operationally (a PC that must stay on, with backups)? | Yes. The backup scheduler already exists. |
| **D6** | Offline overselling: block at cached zero, or allow and reconcile? | Block by default, owner-switchable. |
| **D7** | Allow the **browser** build to queue sales, or desktop only? | Desktop only for v1. |
| **D8** | Who is recorded on a flushed offline sale: the original cashier or the person syncing? | Original cashier. |
| **D9** | Business types: should `OFF` mode be allowed for any business, or only non-VAT-registered ones? | **Needs your/ZRA input.** I cannot determine the legal position. |

## 10. Limits and risks, stated plainly
* **Not verified:** whether a real VSDC can be reached from a shop server without internet (only the mock is deployed); ZRA's rules on offline invoicing (secondary sources only, see the case study).
* **Biggest risk:** Phase 2's meaning change of `COMPLETED`. Mitigated by additive columns, a feature flag, a reader audit and parity tests, but it touches money paths, so it needs the project's two-layer (backend + UI) evidence bar.
* **Cannot be offline by nature:** anything needing a second person's real-time approval, ZRA-verified refunds of unsigned sales, and multi-till stock accuracy when tills are isolated from each other.
* **Capacity:** IndexedDB quotas vary; define a budget and an eviction rule for the catalogue cache (never evict the outbox).
