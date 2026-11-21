# SmartPOS Re-architecture Case Study: offline-first, ZRA-optional, one coherent UI

> Written 2026-11-21 against `main` (last commit `351df71`, plus uncommitted Forecourt work).
> Every claim about our code was checked in the repo this session (file paths cited). Claims about
> other products or about ZRA rules come from web sources listed at the bottom, and are marked
> **[verify]** where the source was secondary. This is a study and a proposal. **Nothing has been changed yet.**

---

## 1. Verdict in one page

SmartPOS today is a **strong, correct, online-only, ZRA-mandatory** system with a **good back-office
and a weak "system shell"**. The domain logic (fiscal state machine, shift/Z-report, RBAC, approvals)
is better than what most small-business POS products ship. What is missing is not features. It is
four foundations:

| # | Foundation | State today | Evidence |
|---|---|---|---|
| 1 | **Offline capability** | Almost none. One IndexedDB store for scan events; no service worker, no manifest, no PWA, no outbox, no idempotency keys. | `public/` holds only `vite.svg`; `grep` for `serviceWorker/workbox/manifest` finds nothing; `src/lib/scanJournal.js` is the only IndexedDB user |
| 2 | **ZRA as optional** | Not possible. `checkoutSale` hard-fails when VSDC is unreachable (503 / `FISCAL_FAILED`). The existing `BusinessProfile.zraEnabled` flag only hides fiscal details on receipts, and its own comment says it does not gate checkout. | `lib/saleFiscal.js:489-496`, `prisma/schema.prisma:1568-1573` |
| 3 | **Navigation / IA** | Organised by *database table*, not by *job*. Till is both a sidebar item and a separate workspace; Forecourt is a stub tab inside the till. | `components/layout/navItems.js`, `CashierTopBar.jsx` |
| 4 | **UI system** | Components exist (`Modal`, `Field`, `StatCard`, `Pagination`) but are not the rule. No toast system, 34 `alert()`s, no tokens in practice, near-zero touch-target discipline. | measured in §3.4 |

**Recommendation:** keep the backend domain model; change *where fiscalization sits* (move it from
"inside the sale" to "an outbox beside the sale"), make the **store server the offline authority**
instead of the browser, and rebuild the shell (navigation, status, notifications, design tokens) once so
every page inherits it. Sequence in §8. Two business decisions are needed from you first (§9).

---

## 2. What "offline completely and online entirely, with or without ZRA" means

You described four operating conditions. Written as a matrix, it is the spec the system must satisfy:

| | **Internet up** | **Internet down** |
|---|---|---|
| **ZRA mode ON** | Sell → sign with VSDC → receipt with fiscal QR. (Today's behaviour, keep.) | Policy decision (§5.3): either *park* the sale until ZRA is back, or *sell with provisional receipt* and fiscalize later. **Needs ZRA confirmation.** |
| **ZRA mode OFF** | Sell, sync to cloud/HQ in background. | **Sell exactly as normal.** Nothing in the sale path may need the internet. |

Two further, independent failure layers are easy to conflate and must be designed separately:

* **Layer A, internet down, store LAN up** (the common case in Zambia: load-shedding, ISP outages). Fixed by making the **store server local and authoritative**.
* **Layer B, till loses the store server** (Wi-Fi drop, server reboot). Fixed by a **PWA with a local outbox on the till device**.

"Completely offline" realistically means surviving both. Our current stack is already a single-instance Docker
stack (`CODEBASE_GUIDE.md` §23: "single shared PostgreSQL, no queue, in-process schedulers"), so Layer A is
mostly an *operating* decision, not a rewrite. Layer B is the new engineering.

---

## 3. Where we stand: evidence

### 3.1 What is genuinely strong (keep, don't redesign)
* Fiscal state machine with stock reservation, reconciliation scheduler, atomic invoice counter.
* Shift lifecycle with decoupled Z-report and cash declaration, segregation of duties enforced by data exposure.
* Configurable RBAC (no admin bypass) + PIN-ticket supervisor approvals.
* Snapshotting of tax/classification onto line items; immutable receipt snapshots; hashed audit log.
* A durable scan journal (`scanJournal.js`: CAPTURED → RESOLVED → SYNCING → SYNCED) that is *the right idea* for the till hot path, currently scoped to a same-session crash only (its own header says multi-day outage tolerance is "out of scope").
* The Forecourt module's **three independent status dimensions** (`operationalStatus` / `fiscalStatus` / `settlementStatus`). This is exactly the pattern the core `Sale` needs (see §5.2).

### 3.2 Offline: what exists vs. what a real offline POS needs

| Capability | Industry standard | SmartPOS today |
|---|---|---|
| App shell loads with no network | Service worker precache | ✗ none (`index.html` fetched from nginx each load; lazy chunks can fail mid-queue, which `App.jsx` already worries about for the till route) |
| Catalog/price/customer cache on device | IndexedDB, loaded when session opens | ✗ catalog fetched live; only scan events persisted |
| Local order queue ("outbox") | Orders stored locally as unsynced, replayed on reconnect, badge shows count | ✗ none |
| Idempotent replay | Client-generated ID on every write, server de-duplicates | ✗ `apiFetch` sends no idempotency key; **a naive retry would double-sell** |
| Status visible to cashier | Offline banner + pending-sync count | Partial: `useOnlineStatus` + `TopBarStatusIcon` show binary state; no pending count because nothing is pending-able |
| Safe auth offline | Existing session keeps working; new login may need server | JWT 24 h, `handleUnauthorized` hard-redirects on any 401 (risk if a token expires while the queue is non-empty) |
| Server-side numbering that survives replay | Local-authoritative counters | Fiscal counter is atomic (good). `shiftNumber`/`zNumber`/PO/GRN use scan-and-increment (`lib/sequentialNumber.js`), weaker under replayed concurrent writes |

### 3.3 ZRA coupling: the single biggest architectural blocker

`finalizeSaleFiscally()` (`lib/saleFiscal.js:489`) begins with a VSDC device check and **throws 503 if the
device cannot be initialised**. Stock is deducted *only after* VSDC success (`completeSaleAfterFiscalSuccess`);
`assertRegisteredProducts()` blocks any product not ZRA-registered; the shift's expected cash counts only `COMPLETED` sales.
Consequence: **VSDC down ⇒ no sale ⇒ no cash movement recorded ⇒ drawer and system disagree**, the opposite of what a
shop owner during load-shedding needs.

Also a latent hazard: `BusinessProfile.zraEnabled` (default `false`) *sounds* like "turn ZRA off" but only hides
fiscal details on printed receipts. Anyone who flips it believing it disables fiscalization would be wrong.
It must be renamed or replaced when real fiscal modes arrive.

### 3.4 UI / navigation: measured, not impressions

| Signal | Count | What it tells us |
|---|---|---|
| Raw Tailwind palette classes (`bg-blue-600`, `text-gray-500`…) in JSX | **1,787** | The design tokens defined in `tailwind.config.js` are bypassed |
| Token usage (`bg-surface…`) | **39** | ~2 % of colour decisions use the system |
| `alert()` calls | **34** | No toast / notification layer |
| `window.confirm()` | **8** | Unstyled, un-themable, un-testable destructive confirmations |
| Hand-rolled `fixed inset-0` overlays | **9** files | Bypass focus-trap/ESC/ARIA of `ui/Modal.jsx` |
| `dark:` variants | 0 | No dark theme (low priority, but cashiers in dim shops/forecourts benefit) |
| Explicit touch-target sizing (`min-h-[40…]`) | 2 | POS is a touch product; targets are not systematically ≥44 px |
| `fetch()` outside `apiFetch` | 3 | Export/report calls bypass the single client, so a future offline/retry layer would miss them |
| Frontend test files | 8 (all nav/RBAC) | No component coverage for checkout, reports, inventory |
| Largest files | `CashierDashboard.jsx` 994 lines, `CheckoutModal.jsx` 844 | The two most important screens are the least decomposed |
| Unused dependency | `framer-motion` | Dead weight |
| Two API folders | `src/api/` and `src/services/` (plus a dead empty `cashierService.js`) | No rule for where new calls go |

**Navigation (current):** 6 sections, 17 destinations: Operations (Cashier, Sales, Cash Register) · Catalog (Products, Inventory, **Customers**) · Supply (Purchasing, Suppliers) · Insights (Reports) · Administration (Users, Roles, Devices, Settings) · Compliance (ZRA Sync, Audit Log).

Problems:
1. **Customers under "Catalog"** is a database-shaped grouping (customers are reference data, not what you sell).
2. **"Cashier" is a sidebar item but really a different application** (own 48 px top bar, own status icons, hides the global header). Two navigation systems for one product.
3. **Operational status is buried.** ZRA/connection state appears as a dot in the sidebar footer and a top-bar icon; there is no place that answers *"is everything synced, what is stuck, what needs me?"*
4. **ZRA Sync is a page**, but ZRA is actually a *mode of the whole business* that should surface as status + exceptions, not a destination most users visit.
5. **Forecourt has no home**: a stub tab inside the till, while the real back-office pages (pumps, attendants, settlements) have nowhere to live.
6. "Cash Register" vs "Cashier" vs "Sales" is three nouns for one job (the sell-and-reconcile loop).

---

## 4. Industry benchmark

**Method note:** Square's and Odoo's offline behaviour were checked against their help/docs pages this session. Toast, Lightspeed, Shopify POS, Clover and Loyverse patterns below are from general industry knowledge and **were not re-verified**. Treat them as direction, not citations.

### 4.1 Offline patterns in the wild

| Product | Offline model | Takeaway for us |
|---|---|---|
| **Square** | Device keeps taking payments, uploads on reconnect. Hard upload window: **72 h** (US Register/Terminal), 24 h on some Canadian readers; Square recommends uploading within 24 h. Expired offline payments are unrecoverable and the merchant bears the risk. No notification of declines while offline. Some tender types are excluded offline. | Offline needs **explicit limits, visible risk and a countdown**, not silent best-effort. |
| **Odoo POS** | Master data preloaded to the browser (IndexedDB) when a session is opened *online*; orders made offline are stored as unsynced; red counter on the connectivity icon; **cannot open a new session offline**. Odoo's own docs describe offline mode as for *short-term interruptions*, not long-term, with a 2 GB cap. Community reports of duplicate re-uploads. | The proven pattern is **preload → local queue → counter → replay**. The duplicate-upload reports are precisely why **idempotency keys** are non-negotiable. |
| **Toast / Lightspeed / Clover** (unverified) | Local hub or device holds the order book; cloud is secondary. | Supports the **store-server-as-authority** choice. |

### 4.2 UX standard for a counter product (consolidated across the above)
1. **One-hand, touch-first**: ≥44 px targets, no hover-only affordances, numeric keypad everywhere money is typed.
2. **Zero-wait hot path**: add-to-cart never awaits the network (we already built this idea in the scan pipeline).
3. **State is always visible, never modal**: connection, sync queue count, fiscal mode, shift status in one persistent strip.
4. **Errors are recoverable inline** (toast + retry), never `alert()`.
5. **Two surfaces, one design language**: a *sell* surface (full-screen, minimal chrome) and a *manage* surface (navigation + dense tables).
6. **Dense, tabular numerals** for money; consistent currency formatting.
7. **Accessible and keyboard-complete** (we already did an accessibility pass; keep it).

### 4.3 ZRA specifics: what is and is not established

* The extracted official spec text in `vsdc-extracted.txt` contains **no offline/queueing rule** (searched for offline, retry, queue, deadlines). Our system therefore cannot claim a ZRA-sanctioned offline behaviour from the spec alone.
* Secondary sources report that ZRA's own desktop/tablet/mobile apps queue invoices offline and auto-submit when connectivity returns, that upload is mandatory after a disruption, and that during announced outages off-system transactions had to be uploaded within **72 hours** **[verify]**. The 72 h figure comes from outage-specific announcements, **not a standing rule I could confirm in an official ZRA document**.
* During outages taxpayers were told to issue manual invoices or use other ZRA-approved systems **[verify]**.

**Implication:** "sell offline now, fiscalize later" is plausible and common in e-invoicing regimes, but **whether our software may legally issue a provisional receipt and sign later must be confirmed with ZRA before it ships as a default.** Build the plumbing as a switchable policy (§5.3), not as an assumption. This also keeps us consistent with the standing "don't claim ZRA compliant/certified" rule.

---

## 5. Target architecture

### 5.1 Three tiers, each independently useful

```
 Tier 1  TILL DEVICE (PWA)            Tier 2  STORE SERVER (authoritative)        Tier 3  CLOUD / ZRA (optional)
 ───────────────────────────          ─────────────────────────────────          ─────────────────────────
 service-worker app shell      ◄─LAN─►  Node + Postgres (what we have)    ◄─WAN─►  ZRA VSDC  (fiscal outbox)
 IndexedDB: catalog cache,             sale / stock / shift / approvals           HQ sync / backup (later)
   scan journal, ORDER OUTBOX          FISCAL OUTBOX + worker                   
 idempotent replay (client UUIDs)      single numbering authority
```

* **Tier 2 is the offline authority.** A store with LAN but no internet runs 100 % normally. This reuses everything we have and removes the hardest problem class (multi-writer conflict resolution), because there is still one writer per store.
* **Tier 1 only has to bridge short gaps to Tier 2** (seconds to hours): queue completed orders with a client-generated ID, replay idempotently. We deliberately do **not** build general browser-side conflict resolution; Odoo's own docs frame browser offline as short-term only.
* **Tier 3 is never in the sale path.**

### 5.2 Decouple the three dimensions of a sale (reuse the Forecourt pattern)

Today one field, `Sale.status`, mixes *commercial*, *fiscal* and *stock* truth
(`PENDING → FISCAL_SUBMITTING → COMPLETED | FISCAL_FAILED`). Replace with independent dimensions, as the Forecourt
module already did for `FuelTransaction`:

| Dimension | Values | Meaning |
|---|---|---|
| `saleStatus` | `OPEN → COMPLETED → REFUNDED` | The commercial fact. **Completes when tender is taken**, regardless of ZRA. Drives stock deduction and cash expectation. |
| `fiscalStatus` | `NOT_REQUIRED · PENDING · SUBMITTING · FISCALIZED · FAILED` | ZRA's state, owned by a **fiscal outbox worker**. |
| `syncStatus` (Tier 1→2) | `LOCAL · SYNCED · REJECTED` | Only meaningful for orders created on a till device while offline. |

`fiscalStatus = NOT_REQUIRED` is how **"ZRA OFF" becomes a first-class mode** rather than a hack.
Data migration: existing `COMPLETED` → `saleStatus=COMPLETED, fiscalStatus=FISCALIZED`; `FISCAL_FAILED` → `saleStatus=OPEN` (or `COMPLETED+FAILED`, per §9 Decision 2).

### 5.3 One business-level fiscal mode (replaces the misleading `zraEnabled`)

| `fiscalMode` | Sale path | When ZRA is unreachable | Receipt |
|---|---|---|---|
| `OFF` | Never calls VSDC; `fiscalStatus = NOT_REQUIRED`. Product-registration gate disabled. | n/a, fully offline-capable | Non-fiscal receipt, clearly labelled |
| `ONLINE_REQUIRED` (today's behaviour, **default**) | Sale completes only on VSDC success. | **Park** the cart (resume when back) or block | Fiscal receipt |
| `DEFERRED` (**only after ZRA confirms it is permitted**) | Sale completes on tender; outbox signs later. | Sell on; queue visible with age and countdown | **Provisional** receipt, reprint fiscal on success |

This directly serves "with ZRA online; without ZRA offline", and makes the legally uncertain part a single switch.

### 5.4 Fiscal outbox (the key new backend component)
A table of `(saleId|refundId|debitNoteId, kind, attempts, nextAttemptAt, lastError, idempotencyKey)` drained by a worker with
exponential backoff. We already own the hard parts: the atomic invoice counter, the 5-minute reconciler that recovers stuck
submissions, and the gateway. The outbox formalises that reconciler into the *primary* path instead of the recovery path.

### 5.5 Offline contract for the till (Tier 1)
* **Open the shift online** (as Odoo does), then preload: catalog, prices, tax config, customers (recent), permissions, supervisor-approver list.
* Every write carries a **client-generated UUID** (`localTxnId`, already present in the scan journal) used as the server's **idempotency key**. A replay of the same ID returns the original result.
* **Supervisor PIN approvals** keep working in the LAN-up case (server-side). In the till-isolated case they are *queued as denied* by default; offline discounts/line reversals are an explicit policy choice, not an accident.
* **Visible risk**, as Square does: outbox count, oldest item age, and, in `DEFERRED` mode, hours remaining to the ZRA window.
* **Stock**: Tier 2 is single-writer, so no oversell conflicts. A Tier-1-isolated till may oversell against stale stock; it is flagged `REJECTED` on replay if the server cannot honour it, never silently accepted.

---

## 6. Target information architecture (navigation)

Principle: **organise by what the user is trying to do, not by table**; one persistent system strip; the till is a
separate *mode*, not a menu item.

```
SYSTEM STRIP (always visible, every screen)
  [● Online/Offline]  [⇅ N pending sync]  [ZRA: Off | Online | Queued N]  [Shift: Open 3h]  [🔔]

SELL MODE  (full-screen, entered from a single "Open till" button; own minimal chrome)
  Quick sale · Held/Drafts · Forecourt* · Shift & Cash

MANAGE MODE (sidebar)
  Home              Dashboard
  Sales             Transactions · Returns & credit notes · Debit notes
  Cash              Registers & shifts · Reconciliation · Z-reports
  Stock             Products · Inventory · Purchasing · Suppliers
  People            Customers · Staff · Roles & permissions
  Insights          Reports
  Forecourt*        Pumps · Attendants · Settlement      (*only when business type = fuel)
  System            Business & taxes · Fiscal (ZRA) · Devices · Sync center · Audit log
```

Key moves:
* **Sync center** (new): one page answering "what is waiting, what failed, what needs a human", merging today's ZRA Sync, fiscal-failed sales and (later) outbox items. ZRA stops being a daily destination and becomes *status + exceptions*.
* **Modules by business type** (Retail / Fuel station): Forecourt appears only where it applies, instead of a permanent stub.
* Permissions and `show()` predicates are reused unchanged; only grouping and labels move (the cheapest, lowest-risk part of this whole study).

---

## 7. UI system standard

1. **Tokens first.** Define semantic tokens (`--color-action`, `--color-danger`, `--space-*`, `--radius-*`, `--text-*`) and ban raw palette classes via ESLint. Target: 1,787 → ~0 raw palette uses outside the token layer. Gives dark mode nearly for free later.
2. **A real component kit**, extending what exists: `Button`, `Modal` (already good), `Field` (already good), **`Toast`**, **`ConfirmDialog`** (replaces 8 `confirm()`), **`DataTable`** (sort/filter/pagination, replaces the per-page hand-rolled tables, fixes the "fetch everything" scale problem), `EmptyState`, `StatusPill`, `Skeleton`.
3. **Retire `alert()`** (34 uses) behind the toast layer; migrate the 9 hand-rolled overlays to `Modal`.
4. **Touch standard**: 44 px minimum targets in Sell mode, numeric keypad component for money entry.
5. **One API client**: fold the 3 stray `fetch()` calls into `apiFetch`, merge `api/` into `services/`, and give `apiFetch` the hooks the offline layer needs (idempotency key, retry policy, offline classification).
6. **Decompose the two giant screens** (`CashierDashboard` 994 lines, `CheckoutModal` 844) *as part of* the offline work rather than separately, because the outbox changes both.
7. **Typography**: replace the Segoe-UI-first stack (not present on Android/Linux tills) with a bundled variable font (e.g. Inter) with tabular numerals for money.
8. Drop `framer-motion`; add component tests alongside each kit component.

---

## 8. Proposed sequence (each phase ships value and is testable alone)

| Phase | Deliverable | Why this order | Risk |
|---|---|---|---|
| **0** | Finish/commit current Forecourt work; fix frontend `node_modules` ownership so frontend tests run | Can't verify UI changes otherwise | Low |
| **1** | **Shell & IA**: system strip, new navigation, Sell/Manage mode split, Toast + ConfirmDialog, tokens + lint rule | Highest visible gain, zero domain risk, every later phase renders into it | Low |
| **2** | **Decouple fiscal from sale**: `fiscalMode`, three-dimension sale model, fiscal outbox + worker, `OFF` mode working end to end | Unlocks "without ZRA, fully offline" immediately; biggest backend change, gets the most tests | **High**, touches the core fiscal path; needs the ZRA two-layer evidence bar |
| **3** | **PWA + Tier 1**: service worker shell, catalog cache, order outbox, idempotency keys, sync badge, offline-aware `apiFetch` | Depends on Phase 2's idempotent, status-decoupled sale | Medium |
| **4** | **Sync center + `DEFERRED` mode** (only if ZRA confirms) | Needs real answers from ZRA | Business, not code |
| **5** | `DataTable` rollout, decomposition of `CashierDashboard`/`CheckoutModal`, dark theme, remaining polish | Safe once the kit exists | Low |
| **6** | Resume Forecourt Phases 2-11 on the new shell | Forecourt then lives inside the real IA | Low |

Explicitly **not** proposed: browser-side CRDTs or multi-writer conflict resolution; microservices or a message broker; a native app rewrite. A local server + PWA is enough and is the shortest path to your goal.

---

## 9. Decisions needed from you

1. **Deferred fiscalization.** Do you want to ask ZRA whether a provisional receipt + later signing is allowed, or ship `OFF` and `ONLINE_REQUIRED` first and add `DEFERRED` only after written confirmation? *(Recommendation: the second, because it keeps us honest on the "don't claim compliant" rule.)*
2. **Meaning of "ZRA on, internet down" until then.** Park the cart, or block checkout with a clear message? *(Recommendation: park, so the cashier can keep serving the next customer and the cart is not lost.)*
3. **Where does the store server live?** An always-on mini-PC/NUC in each shop running our Docker stack, or the cloud with browser-only offline? *(Recommendation: the in-shop server; it is what makes "completely offline" achievable without conflict-resolution machinery. The cloud option can only offer the short-gap behaviour Odoo's docs describe.)*
4. **Rebuild appetite.** The recommended order starts with Phase 1 (shell/IA/UI kit) because it is low-risk and unblocks the rest. Or should Phase 2 (fiscal decoupling) go first because offline matters more to you than the look?

## 10. Risks and open questions
* **Legal:** DEFERRED mode and provisional receipts are unverified against ZRA's standing rules (§4.3).
* **Migration:** reshaping `Sale.status` touches reports, reconciler, Z-report totals, receipts and much of the backend test suite (92 files at last run). This is the main cost driver; do it behind a compatibility view.
* **Mock-vs-reality gap** (from `CODEBASE_GUIDE.md` §21): the mock VSDC has been wrong before. Outbox behaviour on real ZRA error shapes, timeouts and rate limits is untested until sandbox credentials exist.
* **Unknown:** whether the VSDC session file (`tmp/vsdc-session.json`) survives container redeploys, which matters more once the worker drains a queue (guide §24).
* **Browser storage limits:** IndexedDB quota varies by device; Odoo's own offline cap is 2 GB. We need a budget and an eviction policy for the catalog cache.

---

## Sources
* ZRA Smart Invoice offline behaviour (secondary, **[verify]**): [vatupdate.com country booklet](https://www.vatupdate.com/2026/08/31/zambia-e-invoicing-e-reporting-country-booklet/), [DigiTax on SI 58 of 2023](https://news.digitax.tech/p/understanding-statutory-instrument), [IGC: e-invoicing under loadshedding in Zambia](https://www.theigc.org/publications/e-invoicing-adoption-under-loadshedding-zambia)
* Square offline mode and time limits: [Square help: process payments with offline mode](https://squareup.com/help/us/en/article/5095-process-payments-with-offline-mode), [Square offline payments guide](https://squareup.com/us/en/payments/offline-payments-guide)
* Odoo offline behaviour: [Odoo docs: Offline mode](https://www.odoo.com/documentation/20.0/applications/general/offline_mode.html), [Odoo forum: how POS offline works](https://www.odoo.com/forum/help-1/how-is-the-point-of-sale-offline-mode-working-218314), [Odoo forum: duplicate orders on re-upload](https://www.odoo.com/forum/help-1/order-made-to-db-stacks-when-system-is-offline-and-reupload-duplicate-orders-to-db-206699)
