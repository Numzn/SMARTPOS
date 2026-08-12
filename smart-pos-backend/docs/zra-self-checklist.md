# Smart Invoice VSDC — Developer Self-Checklist

**System:** SmartPOS · **Version:** 1.0.0 · **Assessed:** 2026-08-12 (Section 5 classification-picker UI + tax/package/quantity unit UI + corrected code-sync class numbers/response shape + corrected stale item-save endpoint claim + Item 9\* Item Composition built end-to-end + items 27\*/29\* stock-sync double-submission and payload-shape defects fixed + Item 28\* stock retrieval/reconciliation built end-to-end + Item 10\* item retrieval built end-to-end and the invented-path/overwrite-operational-fields defect it replaced decommissioned + a Phase B UI sweep across items 1\*/2\*/7\*/8\*/19\* — new ZRA Sync admin page, product registration status/error/retry UI, ESC/POS receipt formatting fixes — API/data-layer verified, browser-rendering verification pending)
**Assessed against:** VSDC API Specification v1.0.8 (`docs/VSDC-API-Specification-Document-v1.0.8.pdf`)

> **Status: NOT CERTIFIED. NOT SUBMITTED.**
> This is an internal pre-submission assessment, not a compliance claim. Nothing here should be
> described as certified or compliant until ZRA sandbox certification has actually been completed.
>
> Every ✔️ below carries a `file:line` citation. Claims that could not be evidenced in code are ✖️.
> **An endpoint that works only against the mock VSDC server is recorded as ✖️**, because the
> checklist asks about the official endpoint.

**Supersedes** `docs/zra-compliance-checklist.md` (stale, July 2025, self-declared "45%") and
`docs/api-docs/vsdc-reference-index.json` (lists mock paths as spec endpoints and marks them
`completed`). Both should be deleted.

---

## Definition of "done" (adopted 2026-08-11)

Sections 1–4 were audited backend-first: spec → endpoint → VSDC → database → tests → live NumzLab.
That proved the technical integration but not whether a POS operator can actually reach the
capability through the UI. A ✔️ on "retrieve and save classification codes" is true and also
misleading if the product form is still a free-text box no one validates against those codes.

From here on, a functional item is only ✔️ **DONE** when both layers are evidenced:

**Backend layer**
`B1` spec cross-check · `B2` endpoint · `B3` request · `B4` response · `B5` persistence ·
`B6` error handling · `B7` tests · `B8` live NumzLab verification

**UI layer** (only for items with a user-facing surface — not every backend item has one, e.g.
device init may need nothing more than a Settings status line)
`U1` UI exists · `U2` user can access it · `U3` correct permissions · `U4` correct data displayed ·
`U5` user can perform the action · `U6` loading state · `U7` success state · `U8` error state ·
`U9` backend result reflected in UI · `U10` end-to-end browser verification

**Sequencing:** Sections 1–4 already have their backend layer done and are *not* being reopened
mid-audit. Backend-first continues through the remaining sections (Phase A). Once that pass is
complete, a dedicated Phase B sweep adds the UI layer across all sections. **Exception: Section 5
(Item Information)** is done with both layers together, because the UI gap is already confirmed,
not hypothetical — see below.

---

## Headline

| | Count |
|---|---|
| Checklist endpoints implemented against the **official** path | **11 of 17** |
| Mandatory functional items passing | **22 of 27** (items 9\*/28\*/10\* built 2026-08-12, all three tagged OPTIONAL in the real spec, unlike most others in this list, see their rows; item 19\* moved ⚠️→✔️ 2026-08-12 — both remaining ESC/POS formatting sub-items fixed) |
| Mandatory functional items partial | **2** (item 8\* — save-endpoint routing correct, UI status/error/retry added 2026-08-12 but deliberately kept ⚠️ pending real browser verification, see its row) |
| Mandatory functional items failing | **3** |

**Correction, 2026-08-12: item registration IS already on its official path.** This section previously
claimed `services/itemManagement.js` hardcoded a mock path instead of `endpointAdapter.path('itemSave')`
— re-checked directly against the current code while planning item 9\* (Item Composition) and found the
claim stale: `submitWithRetry()` (`services/itemManagement.js:113-117`) already calls
`endpointAdapter.path('itemSave')`, exactly the same pattern as device initialisation (which had the
identical false claim, corrected 2026-08-11, see item 1\* below). `vsdcService.js`'s own
`this.endpoints.itemSave = '/api/items/save'` (`:32`) is dead code with zero call sites — it looks like
the hardcoded mock path this claim describes, but nothing actually calls it. Already covered by a
passing regression test (`tests/unit/vsdcOfficialRouting.unit.test.js:35-47`,
`tests/unit/endpointAdapter.unit.test.js:27-39`) that predates this correction. Live re-verified
2026-08-12: a real product create round-tripped through `saveItemToVSDC` → `submitWithRetry` →
`endpointAdapter.path('itemSave')`, hit the mock VSDC's `/api/items/save` handler (`VSDC_MODE` is unset
on Numzlab, so mock mode is correct and expected there — not evidence of a hardcoded bypass), logged
`📦 Mock VSDC item save: TEST-ITEMSAVE-PATH-1` at the matching timestamp, and persisted
`zraRegistrationStatus='REGISTERED'` with `resultCd='000'`. See item 8\*'s row below for full detail.
Both `initialize` and `itemSave` were victims of the same failure mode: trusting an old note instead of
re-reading the current code — a caution for every other ✖️ claim still in this document.

15 of the 17 adapter keys are used (`initialize`, `codes`, `itemClass`, `itemSave`, `itemComposition`,
`salesSave`, `salesSelect`, `stockItems`, `stockMaster`, `stockItemsSelect`, `itemsSelect`,
`branchesSelect`, `branchUserSave`, `branchCustomerSave`, `customerSelect`) — verified by exhaustive
grep of `lib/`, `services/`, `routes/` for `endpointAdapter.path(...)` call sites. `itemUpdate` and
`purchaseGet` remain genuinely unused (0 call sites for either).

---

## SECTION 1: TAXPAYER DETAILS

*To be completed by the taxpayer — these values are not derivable from the codebase.*

| Field | Value |
|-------|-------|
| SUPPLIER NAME | |
| TPIN NUMBER | |
| TELEPHONE Nos | |
| CONTACT PERSON | |
| POSITION | |
| COMPUTERISED ACCOUNTING PACKAGE DETAILS | |
| SYSTEM / PACKAGE NAME | SmartPOS |
| VERSION NUMBER | 1.0.0 (`smart-pos-backend/package.json`) |
| LICENCE NUMBER | |

---

## SECTION 2: API ENDPOINT CHECKLISTS

### 2.0 Endpoint coverage summary

| # | Checklist endpoint | Official path (spec v1.0.8) | Status |
|---|---|---|---|
| 1 | Device Initialisation | `/initializer/selectInitInfo` | ✔️ **this row was stale — see item 1\* below, corrected 2026-08-11** |
| 2 | Get Code Data | `/code/selectCodes` | ✔️ |
| 3 | Get Branch Customers | `/customers/selectCustomer` | ✔️ **corrected 2026-08-11 — the endpoint name here was fabricated; no `/branches/selectBranchCustomers` exists in the spec at all. The real endpoint is `/customers/selectCustomer` (Section 5.6, a different namespace), an on-demand lookup by `custmTpin`, not a bulk branch-customer list.** |
| 4 | Save Branch Customer | `/branches/saveBrancheCustomers` | ✔️ |
| 5 | Item Class | `/itemClass/selectItemsClass` | ✔️ |
| 6 | Save Branch User | `/branches/saveBrancheUser` | ✔️ **corrected 2026-08-11 — spec has it singular ("User"), every prior reference in this codebase/doc assumed plural.** |
| 7 | Get Branch Information | `/branches/selectBranches` | ✔️ |
| 8 | Save Item Information | `/items/saveItem` | ✔️ **corrected 2026-08-12 — this row was stale, see item 8\* below** |
| 9 | Get Item List | `/items/selectItems` | ✔️ **built 2026-08-12 — see item 10\* below** |
| 10 | Get Import Items | `/imports/selectImportItems` | ✖️ absent |
| 11 | Update Import Item | `/imports/updateImportItems` | ✖️ absent |
| 12 | Save Sales | `/trnsSales/saveSales` | ✔️ |
| 13 | Get Purchases | `/trnsPurchase/selectTrnsPurchaseSales` | ✖️ absent |
| 14 | Get Stock Item List | `/stock/selectStockItems` | ✔️ **built 2026-08-12 — see item 28\* below** |
| 15 | Save Stock Item | `/stock/saveStockItems` | ⚠️ partial |
| 16 | Save Stock Master | `/stockMaster/saveStockMaster` | ⚠️ partial |
| 17 | Save Purchases | `/trnsPurchase/savePurchases` | ✖️ absent |

Additionally implemented but not on the checklist: `/trnsSales/selectSales` — used by the fiscal
reconciliation sweeper (`lib/fiscalReconcile.js:31`).

---

### 2.1 Implemented endpoints — detailed

Shared infrastructure, applies to all four:

- **Transport** `lib/vsdc-gateway/transport.js` — base URL `baseUrl():5`, headers `:17-26`
  (`Content-Type: application/json`, `Authorization: Bearer`, `X-Request-ID`, `X-Session-ID`).
- **HTTP method** — all VSDC calls are `POST` (`transport.js:15`).
- **Success predicate** `transport.js:30` — `resultCd === '000'`.
- **Retry** `lib/vsdc-gateway/retry.js:1-19` — 3 attempts, exponential backoff, retryable only on
  `ECONNRESET`/`ETIMEDOUT`/timeout/HTTP≥500.

#### 2 — GET CODE DATA · `/code/selectCodes` ✔️

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Endpoint URL correct | ✔️ | `lib/vsdc-gateway/endpointAdapter.js:7`, resolved via `path('codes')` at `codesSync.js:19` |
| 2 | Request parameters | ✔️ | `codesSync.js:20-25` — `tpin`, `bhfId`, `lastReqDt` |
| 3 | Request headers | ✔️ | `transport.js:17-26` |
| 4 | Request body structure | ✔️ | `codesSync.js:20-25`, JSON via axios |
| 5 | HTTP method POST | ✔️ | `transport.js:15` |
| 6 | Response body verified | ✔️ | `codesSync.js:27-56`, handles nested + flat shapes |
| 7 | Error handling | ⚠️ | `codesSync.js:30` throws on non-`000`; **no per-`resultCd` branching** |
| 8 | Security | ⚠️ | Transport is whatever `VSDC_URL` specifies. Bearer token present. **Not yet exercised against an HTTPS sandbox.** |

#### 5 — ITEM CLASS · `/itemClass/selectItemsClass` ✔️

Same shape as above. `endpointAdapter.js:8` → `path('itemClass')` at `codesSync.js:60`; response
handling `codesSync.js:63-93`.

> ⚠️ `MOCK.itemClass` (`endpointAdapter.js:21`) holds the **official** path, so mock and official
> runs are indistinguishable here — the mock provides no independent verification.

#### 12 — SAVE SALES · `/trnsSales/saveSales` ✔️

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Endpoint URL correct | ✔️ | `endpointAdapter.js:11` → `path('salesSave')` at `lib/vsdc-gateway/index.js:54` |
| 2 | Request parameters | ✔️ | `payloadBuilders/saveSales.js:77-213` |
| 3 | Request headers | ✔️ | `transport.js:17-26` |
| 4 | Request body structure | ⚠️ | Built at `saveSales.js:77-213`. Validation `validators/saveSales.js:1-15` checks only tpin/bhfId/non-empty itemList/exchangeRt/total-vs-sum. **No per-item, tax-bucket, date-format or enum validation.** Validation is enforced *only* in official mode (`index.js:50`), and mock mode validates a synthetic payload — so mock runs never exercise the sandbox's check. |
| 5 | HTTP method POST | ✔️ | `transport.js:15` |
| 6 | Response body verified | ✔️ | `mapSaleResponse` `index.js:14-27` |
| 7 | Error handling | ✖️ | `resultCd` is returned at `index.js:60-64` then **discarded** when `zraInvoice.js:74` rewraps it into `new Error(message)`. The numeric ZRA code is never persisted. `007` (duplicate) is not special-cased. |
| 8 | Security | ⚠️ | As above — not yet exercised against sandbox. |
| 9 | Sales showing on taxpayer portal | ✖️ | **Cannot be verified without sandbox credentials.** |

#### 15/16 — SAVE STOCK ITEM & SAVE STOCK MASTER ⚠️ partial

`endpointAdapter.js:13-14` → `path('stockItems')`/`path('stockMaster')` at `index.js:88-89`.

Three defects keep these at partial:

1. **Fired only on the sale path.** `postSaleStock` (`index.js:86`) runs after a non-credit sale.
   Stock changes from GRN, adjustments, stock-take, expiry write-off and supplier returns do *not*
   reach these endpoints.
2. **Errors are silently swallowed** — `.catch(() => null)` at `index.js:107` and `:118`. A non-`000`
   result is discarded, so ZRA-side stock can drift from a fiscalized sale with no record.
3. **The ledger-driven sync bypasses the adapter entirely.** `vsdcService.submitStockIo`
   (`services/vsdcService.js:736`) posts to the hardcoded mock path `/api/stock/save`
   (`vsdcService.js:33`), so in official mode it targets the wrong URL.

Portal verification: ✖️ pending credentials.

---

### 2.2 Not implemented

For endpoints 1, 3, 4, 6, 7, 8, 10, 11, 13, 14 and 17, **all eight sub-items are ✖️** — there is
nothing to assess. (Endpoint 9, Get Item List, removed from this list 2026-08-12 — see item 10\*
above.) **Note:** several other numbers in this list (1, 3, 4, 6, 7, 8, 14) were corrected to ✔️
in §2.0/§3 by sessions after this section was originally written and this paragraph was not
re-audited line-by-line — treat §2.0's coverage table as authoritative over this paragraph's
prose. Detail on the two that look implemented but are not:

**1 — Device Initialisation.** `OFFICIAL.initialize = '/initializer/selectInitInfo'` exists at
`endpointAdapter.js:6` but `path('initialize')` is never called. The live init at
`services/vsdcService.js:156` uses `this.endpoints.initialize` = `/api/initialize`, a hardcoded
mock-server path, reached from `routes/vsdc.js:25` and `lib/saleFiscal.js:355`. The official path is
exercised only by `scripts/sandbox-smoke.js:62`, which bypasses all application code.

**8 — Save Item Information.** `OFFICIAL.itemSave = '/items/saveItem'` exists at
`endpointAdapter.js:9` but `path('itemSave')` is never called. The live save at
`services/itemManagement.js:124-128` uses `/api/items/save` (`vsdcService.js:31`).

**7 — Get Branch Information.** Uses an invented path `GET /api/branch/get/:bhfId`
(`routes/branches.js:152`, `vsdcService.js:36`) that exists only in `mock-vsdc-server.js:178`.
Branch *save* likewise posts to `/api/branch/save`, which is not a spec path.

**13/17 — Purchases.** `lib/purchasing.js:4` documents purchase orders as *"Non-fiscal business
documents — no VSDC involvement."* `endpointAdapter.js:15` defines `purchaseGet` with a
**different path than the spec** (`/trnsPurchase/selectPurchases` vs
`/trnsPurchase/selectTrnsPurchaseSales`) and never calls it.

---

## SECTION 3: FUNCTIONAL CHECKLIST

\* = mandatory

| No. | Service check | Status | Evidence / gap |
|-----|---------------|--------|----------------|
| | **Device Initialisation** | | |
| 1\* | Initialize with Smart Invoice via VSDC | ✔️ | **Correction — this entry was stale.** `vsdcService.initialize()` (`services/vsdcService.js:157`) posts through `endpointAdapter.path('initialize')`, resolving to the real official path under `VSDC_MODE=official`. `this.endpoints.initialize = '/api/initialize'` (`:30`) is dead code, referenced nowhere. Both call sites (`routes/vsdc.js:25`, `lib/saleFiscal.js:370`) go through `ensureDeviceInitialized()` → `initialize()`, same correct path. Regression test: `tests/unit/vsdcOfficialRouting.unit.test.js:17-32`. Live-verified against Numzlab (2026-08-11): forced a fresh init (session file cleared) with `VSDC_MODE=official`, confirmed `POST /initializer/selectInitInfo` actually fired, `resultCd='000'`, response (`sdicId`, `mrcNo`, `intrlKey`, `signKey`, `cmcKey`) persisted to `vsdc_devices`; forced a network failure and confirmed graceful `{success:false}` with no crash; restarted the `smart-pos-backend` container and confirmed `isDeviceReady()` still returns `true` (state persisted in Postgres, not memory). Mandatory-field payload (`tpin`, `bhfId`, `dvcSrlNo`) cross-checked against `scripts/sandbox-smoke.js:63`, written independently for real-sandbox use — not verified against the literal spec PDF text (no PDF renderer in this environment). ⚠️ Real ZRA sandbox behavior (vs. mock) still unverified — no credentials.

**UI gap fixed 2026-08-12:** status was previously visible only on the cashier till (`StatusBar.jsx`, via `cashierApi.js:fetchVsdcStatus`) — an admin who never opened the till screen had no way to see device status, and there was no manual re-init trigger anywhere. Added a new `ZRA Sync` admin page (`smart-pos-frontend/src/pages/ZraSyncPage.jsx`, nav entry gated on `zra:read`) with a `DeviceStatusCard` showing initialized state/serial/SDC ID/MRC No/last-init time, plus an "Initialize" trigger gated on `zra:sync`. No new backend logic — reuses the existing `GET /vsdc/status`/`POST /vsdc/initialize` routes. Live-verified against Numzlab: both endpoints return correct data via direct API call matching the card's expected shape exactly. ⚠️ Production build succeeded cleanly (Vite, no errors) and the API contract was verified end-to-end, but the page was **not visually confirmed rendering in an actual browser this session** — the available browser-automation tool couldn't reach Numzlab's published ports from its sandbox network. Flagged honestly rather than claimed as full browser E2E. |
| | **Get Code Data** | | |
| 2\* | Retrieve code data (VSDC constants) | ✔️ | `lib/vsdc-gateway/codesSync.js:17-56`; route `routes/vsdc.js:69`. Sync verified live against Numzlab (2026-08-11): `POST /code/selectCodes` under `VSDC_MODE=official`, response persisted to `zra_codes` with fresh `syncedAt`, confirmed refreshable. **Fixed a real gap the same day:** codes were retrieved and stored but never consumed — `services/itemManagement.js` hardcoded `taxTypes`/`packageUnits` as JS constants instead, and since the frontend never sets `Product.taxType`/`zraPackageUnit`/`zraQuantityUnit`, the hardcoded fallback was the de facto value on every real item registration. Now resolved via `services/zraCodesService.js` (`getDefaultTaxTypeCode()`/`getDefaultUnitCode()`, reused rather than duplicated — it already existed but was dead code, reachable only from `docs/compliance-checker.js`), which throws a clear error rather than silently substituting a hardcoded guess if the code class was never synced. Hardcoded constants removed after confirming zero remaining consumers. Live end-to-end verified: registered a real product with no explicit `taxType`/`zraPackageUnit` set, confirmed `POST /items/saveItem` succeeded using the synced `A`/`EA` codes. Tests: `tests/unit/zraCodesResolution.unit.test.js` (8 tests — resolution prefers requested code, falls back to first available, throws on unresolvable, item registration uses resolved defaults only when product fields are unset, explicit fields bypass the lookup, failure propagates cleanly). ⚠️ The `SPECIAL:'D'` tax-type discrepancy found during this audit (hardcoded but absent from the mock's synced list) was deliberately *not* removed or assumed invalid — the mock's small sample isn't proof of the real ZRA production code set. ⚠️ Real ZRA sandbox behavior still unverified — no credentials.

**UI gap fixed 2026-08-12:** zero frontend surface existed for codes sync — no last-synced display, no manual trigger. Added a `CodesSyncCard` to the new `ZRA Sync` page (see item 1\*'s row for the page itself), backed by a new read-only `GET /api/vsdc/codes/status` route (`routes/vsdc.js`) — the only backend change in this fix, since codes sync is upsert-all-on-demand with no existing cursor/status table to read from; aggregates directly off `ZraCode`/`ZraClassificationCode.syncedAt`. Test: `tests/integration/vsdcCodesStatusRoute.integration.test.js` (4 cases — auth gate, CASHIER-reachable since `zra:read` is broadly granted, response-shape typing without assuming an empty table since `ZraCode` is a shared table other test files write to, correct per-class counts/timestamps after inserting fixtures) — 396/396 backend passing (up from 392). Live-verified: `GET /api/vsdc/codes/status` and `POST /api/vsdc/codes/sync` both confirmed against Numzlab returning real aggregated data matching the card's expected shape. Same browser-verification caveat as item 1\*'s row — not visually confirmed in an actual browser this session. |

**Correction, 2026-08-11 (same-day Section 5 follow-up):** the "sync verified live" claim above was true only against a mock that was itself wrong in the same two ways as the code — checked directly against the spec PDF text while building item 8\*'s Tax Type/Package Unit/Quantity Unit selectors and found: (1) `CODE_CLASS_MAP` used class numbers `01`/`03`/`04` for tax/unit/packaging; the real spec (confirmed via `vsdc-extracted.txt`) is `04`/`10`/`17`. (2) `codesSync.js` parsed a flat `cdList` array that does not exist anywhere in the spec — the real `/code/selectCodes` response nests codes by class (`data.clsList[].{cdCls,cdClsNm,dtlList[]}`), so against real ZRA this sync would have imported **zero** codes, not the wrong ones — a parsing failure, not just a mislabeling. Both fixed in `codesSync.js`/`zraCodesService.js`/`mock-vsdc-server.js`; full detail and live re-verification under item 8\*'s row below. This item's ✔️ still stands (code retrieval + consumption both genuinely work, now against the corrected shape and classes) but the earlier "verified" evidence should be read as superseded by the corrected version, not as ever having proven the real-ZRA-shape case. |
| | **Classification Codes** | | |
| 3\* | Retrieve and save classification codes | ✔️ | `codesSync.js:58-93` — `POST /itemClass/selectItemsClass` with `tpin`/`bhfId`/`lastReqDt`; persists to `ZraClassificationCode`. **Fixed a real bug the same day (2026-08-11):** `GET /api/items/classification-codes` called `itemManagementService.getItemClassificationCodes()`, which bypassed `endpointAdapter` entirely and posted to a hardcoded mock-only path (`/api/codes/get`) on every request instead of reading the synced table — same defect pattern as item 2\*'s tax/unit codes, different endpoint. Fixed by pointing the route at `zraCodesService.getItemClassifications()` (already existed, already correct, just unused — same "reuse, don't rebuild" pattern as item 2\*). Also added `taxTyCd`/`mjrTgYn`/`useYn` as first-class columns on `ZraClassificationCode` (previously only in an opaque `raw` JSON blob) and wired filtering so a code ZRA marks `useYn='N'` (deprecated) is never served — verified live: synced 3 classification codes against Numzlab's mock (2 usable + 1 deliberately `useYn='N'`), hit the real HTTP endpoint with a real JWT, confirmed only the 2 usable codes returned. **UI layer closed 2026-08-11 (Section 5):** see item 8\*'s row below — `ClassificationPicker.jsx` now consumes this endpoint via a bounded, server-side `?q=&limit=` search (`zraCodesService.searchItemClassifications`), and the free-text field it replaced is gone. Tests: `tests/unit/classificationCodes.unit.test.js` (4), `tests/integration/classificationCodesRoute.integration.test.js` (3), plus the new search/picker tests cited under item 8\*. |
| | **Branch Information** | | |
| 4 | Save branch customer details | ✔️ | **Section 4, done 2026-08-11.** Endpoints verified directly against the spec PDF (`POST /branches/saveBrancheCustomers`), not inferred from prior code — real spec text disagreed with what earlier drafts of this doc assumed. `lib/vsdc-gateway/branchSync.js` `saveBranchCustomer()`; route `POST /api/customers/:id/zra-sync` (gated `zra:sync`, deliberately not `customers:write` — pushing fiscal data is a different sensitivity tier than a cashier's quick-add). `custTpin` is a required VSDC field, so a customer with no TPIN is rejected before any network call — that's the real business trigger, not "sync every customer." No new model: existing `Customer` (name/phone/tpin/address/email/isActive/notes) already maps directly onto ZRA's fields. Live-verified against Numzlab: created a real customer with a TPIN, pushed it, `resultCd='000'`, `zraSyncedAt` persisted. Tests: `tests/unit/branchSync.unit.test.js` (13, shared with items 5-7), `tests/integration/customerZraSync.integration.test.js` (6). |
| 5 | Retrieve branch customer details | ✔️ | **Section 4, done 2026-08-11.** The endpoint name in this doc was previously fabricated (`/branches/selectBranchCustomers` — does not exist in the spec at all). The real endpoint is `POST /customers/selectCustomer` (Section 5.6 "Customer Information," a *different namespace* than the other Section 5.5 branch endpoints), an on-demand lookup by `custmTpin`, not a bulk list. `branchSync.js` `selectCustomer()`; route `GET /api/customers/zra-lookup?tpin=...` (read-only, `customers:read`). Live-verified: looked up the customer just pushed for item 4 by TPIN, got back matching data — proves the full save→retrieve round-trip against Numzlab's mock, not just each endpoint in isolation. |
| 6 | Save branch user details | ✔️ | **Section 4, done 2026-08-11.** Spec endpoint is `POST /branches/saveBrancheUser` — **singular** "User," verified directly against the PDF; every prior reference anywhere in this codebase assumed the plural form, which would have 404'd against real ZRA. Clarified NUMZ's application login is *not* automatically the same thing as a ZRA branch user — they're related but distinct concepts (per the audit's explicit instruction). `bhfId` is required, resolved via `User.branchId → Branch.code → Branch.bhfId`; a user with no assigned branch is rejected before any network call. No new model: existing `User` maps directly. Route `POST /api/users/:id/zra-sync` (ADMIN only). Live-verified against Numzlab: real finding — **zero seeded users currently have a branch assigned** (confirmed the guard correctly rejects the real admin account); success path verified with a dedicated test user, cleaned up after. Tests: `tests/integration/userZraSync.integration.test.js` (4). |
| 7\* | Retrieve registered branch details | ✔️ | **Section 4, done 2026-08-11.** Was reachable only via a fabricated endpoint (`GET /api/branch/get/:bhfId` — wrong method, wrong path, wrong request shape; real spec is `POST /branches/selectBranches` with a JSON body). The old code's failure was silently swallowed (`catch` → `zraDetails = null`, no error surfaced) — a real correctness gap independent of the wrong-endpoint bug. Fixed: `branchSync.js` `selectBranches()`; route `POST /api/vsdc/branches/sync` (mirrors the existing `codes/sync` pattern, `zra:sync`). Retrieved data is stored as a **reference snapshot** (`Branch.zraBranchSnapshot`) rather than overwriting operational fields (`name`/`province`/`district`/...) — those are foreign-key-critical locally (`sales.branchId`, shifts) and ZRA's copy is something to compare against, not an authority that should silently mutate live records. Live-verified against Numzlab: ZRA's mock returned a different branch name ("Headquarter") than the local operational record ("Main Branch") — confirmed the snapshot captured it while the operational `name` field stayed untouched. ⚠️ `routes/branches.js`'s pre-existing `registerBranchWithZRA()` and its `GET /:id` ZRA-details fetch still target the fabricated `/api/branch/save` / `/api/branch/get/:bhfId` paths and were deliberately left alone — **no "Save Branch" endpoint exists anywhere in the real spec at all** (confirmed by full-text search of the spec PDF); branch registration is a ZRA-portal-only administrative act. That pre-existing feature is out of scope for this section and flagged as a separate cleanup, not fixed here.

**UI gap fixed 2026-08-12:** no branch page existed in the frontend at all — `GET /api/branches` already returned the full snapshot but nothing consumed it. Added a `BranchSnapshotCard` to the new `ZRA Sync` page (see item 1\*'s row) rendering local operational fields next to the ZRA snapshot per branch, plus a manual sync trigger. No new backend read endpoint needed. Live-verified against Numzlab: triggered `POST /api/vsdc/branches/sync`, confirmed `Branch.zraBranchSnapshot` populated with the exact field names the card renders (`bhfNm`, `prvncNm`, `dstrtNm`, `sctrNm`, `locDesc`, `mgrNm`, `mgrTelNo`, `mgrEmail`, `bhfSttsCd`, `hqYn`), operational `name` field unchanged, `zraSnapshotSyncedAt` set. Same browser-verification caveat as item 1\*'s row. |
| | **Item Information** — *per the "Definition of done" section above, this section requires both backend (B1-B8) and UI (U1-U10) layers before ✔️* | | |
| 8\* | Save item details, transmit via VSDC | ⚠️ | **Backend routing corrected 2026-08-12 (was believed ✖️, was actually already right):** re-checked `itemManagement.js` directly against the current code instead of trusting this row's prior claim — `submitWithRetry()` already calls `endpointAdapter.path('itemSave')` (`services/itemManagement.js:113-117`), resolving to `/items/saveItem` under `VSDC_MODE=official`. The `/api/items/save` hardcoded-path claim described `vsdcService.js`'s `this.endpoints.itemSave` (`:32`) — dead code with zero call sites, not what `submitWithRetry` actually uses. Already covered by a passing regression test that predates this correction (`tests/unit/vsdcOfficialRouting.unit.test.js:35-47` — asserts the exact HTTP path `submitWithRetry` posts to, both modes; `tests/unit/endpointAdapter.unit.test.js:27-39` covers the mapping itself). Live re-verified 2026-08-12: created a product via direct API call (`zraClassificationCode='50101500'`, no tax/unit fields), confirmed `zraRegistrationStatus='REGISTERED'`, `vsdcItemResponse.resultCd='000'`, and the mock VSDC's own log showed `📦 Mock VSDC item save: TEST-ITEMSAVE-PATH-1` at the matching timestamp — `VSDC_MODE` is unset on Numzlab (mock mode), so hitting `/api/items/save` there is correct, expected behavior, not evidence of a bypass; the official-mode path is proven by the regression test since no real ZRA credentials exist to exercise it live. Test product removed via API delete after verification (catalog count 208→209→208). See §2.0 row 8 (corrected alongside this). This was the same failure mode as item 1\*'s stale claim — a documentation error, not a code defect; full corrected context in §2.0's "single most important... finding" paragraph, now itself corrected. **Classification UI gap fixed 2026-08-11 (Section 5):** the free-text `zraClassificationCode` input in `ProductModal.jsx` — the specific defect confirmed against the live code (`ProductModal.jsx:198-206`, no validation against synced codes) — is replaced by `ClassificationPicker.jsx` (`smart-pos-frontend/src/components/products/ClassificationPicker.jsx`), a debounced type-ahead backed by `GET /api/items/classification-codes?q=&limit=` (`services/zraCodesService.js` `searchItemClassifications()` — server-side search/pagination, never the whole table, `useYn='N'` codes excluded). The stored value only ever comes from clicking a returned result; typing text that matches nothing and submitting is blocked by both a new required-field check (`smart-pos-frontend/src/utils/productUtils.js`) and a server-side validity gate (`routes/products.js` `assertUsableClassificationCode()`, checked via `zraCodesService.isUsableClassificationCode()` on both create and update, independent of the UI). Investigated first whether the classification codes form a real hierarchy before building a flat picker: the spec confirms `itemClsCd` is UNSPSC (`itemClsLvl` 1-4), but the locally synced data has no derivation logic anywhere in the codebase (`getItemClassifications()` hardcodes `parentCode: null`) and the mock/dev dataset is 3 flat rows — so a flat, server-searched picker was the correct scope, not a tree; the component's `value`/`onChange` contract (bare `itemClsCd` string) is designed so a hierarchical variant could replace it later without touching `ProductModal` or the VSDC payload builder. Tests: `tests/unit/classificationCodeSearch.unit.test.js` (11), `tests/integration/classificationCodesSearch.integration.test.js` (5), `tests/integration/productClassificationValidation.integration.test.js` (5) — 21 new, all passing alongside the existing 261 (282 total). **Live-verified against Numzlab (2026-08-11), full browser E2E:** opened Add Product, searched the picker for "food" (debounced, server-filtered to the one match, deprecated `useYn='N'` mock row correctly absent from even the unfiltered initial list), selected "50101500 Food and beverages", submitted — product created with `zraClassificationCode='50101500'`, `zraRegistrationStatus='REGISTERED'`, a real `POST /items/saveItem` round-trip to the mock VSDC (`resultCd='000'`, confirmed via direct Postgres query on the Numzlab container and the mock's request log). Separately confirmed the negative case: typed "zzz" into the picker without selecting a result, attempted submit — blocked client-side with "ZRA classification code is required — search and select one," proving typed-but-unselected text never reaches `productData`. Test product deleted after verification (Products catalog count round-tripped 208→209→208).

**UI-status/error-surface gap addressed 2026-08-12, row deliberately stays ⚠️ not ✔️:** `ProductsTable.jsx`'s badge showed status but never `zraRegistrationError`, and there was no retry action; `ProductModal.jsx` showed zero ZRA feedback in either create or edit mode; `ProductsPage.jsx`'s create/update handlers always alerted a generic success message even when the response's product carried `zraRegistrationStatus:'FAILED'`. Fixed: `ProductsTable.jsx` now shows the error message in red under the badge and a "Retry" link (reusing the already-wired `onEdit` prop, no new plumbing) when `FAILED`; `ProductModal.jsx`'s edit mode shows the same status/error; `ProductsPage.jsx` checks the saved product's `zraRegistrationStatus` via a new `getSavedProductFromResult()` normalizer (`utils/productUtils.js` — create and update return asymmetrically-shaped responses, `{product,...}` vs a flat spread, confirmed by reading both routes) before deciding which alert to show. **Verified against Numzlab at the API/data layer**, full failure→retry→recovery cycle: stopped `mock-vsdc`, edited an existing `PENDING` product (`SUGAR2K`) with a valid classification code — update returned 502 as expected (strict mode) and the row persisted as `zraRegistrationStatus:'FAILED'`, `zraRegistrationError:'Unknown VSDC error'`; confirmed via `GET /api/products` that both fields the table/modal read are present in the list response exactly as the components expect; restarted `mock-vsdc`, re-saved the same product — confirmed it flipped back to `REGISTERED` with `zraRegistrationError` cleared. ⚠️ **U10 (end-to-end browser verification) not met this session** — the browser-automation tool available couldn't reach Numzlab's published ports from its sandbox network, so the retry-link/error-text actually rendering on screen was never visually confirmed, only proven correct by data-contract match and code review. Per this doc's own Definition of Done, that keeps this row at ⚠️ rather than ✔️ until someone verifies it in an actual browser.

**Tax Type / Package Unit / Quantity Unit UI gap fixed 2026-08-11 (Section 5, same day, separate pass).** Before building these, inspected the actual code categories against the spec text rather than trusting the existing `CODE_CLASS_MAP` — and found the sync layer itself was wrong, not just missing UI: (1) `zraCodesService.js`'s `CODE_CLASS_MAP` had `TAX_TYPES:'01'`, `UNIT_OF_MEASURE:'03'`, `PACKAGING_UNITS:'04'` — the real spec (confirmed directly from `vsdc-extracted.txt`: §5.2's sample response shows `cdCls:"04"`/`"Taxation Type"`; §6.5 says "refer to class code 10"; §6.4 says "refer to class code 17") is `04`/`10`/`17` — meaning the old `PACKAGING_UNITS` value ('04') actually pointed at real Tax Type. (2) `codesSync.js`'s `syncStandardCodes()` parsed a flat `cdList` array that appears nowhere in the spec — the real `/code/selectCodes` response is nested (`data.clsList[].{cdCls,cdClsNm,dtlList[].{cd,cdNm}}`), so against a real ZRA sandbox this parser would have imported **zero** codes, silently. `mock-vsdc-server.js` had been built to match both wrong assumptions (flat shape, wrong class numbers), which is why item 2\*'s prior "live-verified against Numzlab" claim never caught either bug — the mock and the code were self-consistently wrong together. Fixed both (`lib/vsdc-gateway/codesSync.js`, `services/zraCodesService.js`, `mock-vsdc-server.js`); see item 2\*'s row above for the corresponding update.

Built `ZraCodeSelect.jsx` (`smart-pos-frontend/src/components/products/ZraCodeSelect.jsx`) — a native `<select>` (not a search type-ahead like classification; these are short, ~4-10 code enumerable lists, and a native select also makes "no arbitrary text" free) — three instances wired into `ProductModal.jsx` for Tax Type, Package Unit, Quantity Unit, backed by new endpoints `GET /api/items/tax-types` / `/package-units` / `/quantity-units` (`zraCodesService.js` `searchTaxTypes()`/`searchPackagingUnits()`/`searchQuantityUnits()`). Unlike classification codes, standard `ZraCode` rows have no `useYn`/deprecation flag — nor does the real spec response provide one for this data — so "exclude deprecated" is implemented as a freshness heuristic (`getCurrentCodesForClass()`): a code not touched by the most recent sync for its class is treated as no longer offered.

**Deliberately not made required.** Live DB check on Numzlab before building anything: all 208 existing products have `taxType=NULL`, 202/208 have `zraPackageUnit`/`zraQuantityUnit=NULL` — the pre-existing `validateRegistrationFields()` presence check for package/quantity unit is neutralized by `Product.unit` defaulting to `'EA'` regardless, and never checked `taxType` at all. Forcing these three fields would have broken every one of those products on next edit. Instead: validity-if-present only (`routes/products.js` `assertProductZraCodes()` → `zraCodesService.isUsableStandardCode()`), enforced on both create and update independent of the UI; the registration-time default-resolution logic (`resolveDefaultCode`/`getDefaultTaxTypeCode`/`getDefaultUnitCode`, item 2\*) is untouched and still supplies a real synced default when these are null. Also removed a hardcoded `'EA'` fallback that `routes/products.js` had been silently writing onto `zraPackageUnit`/`zraQuantityUnit` when the user provided nothing — that fallback predates this session and was itself an unvalidated guess (not necessarily even a valid *packaging* code) baked onto the product record as if confirmed.

Tests: `tests/unit/codesSyncStandardCodes.unit.test.js` (4), `tests/unit/zraCodesStandardSelectors.unit.test.js` (11), `tests/integration/zraCodesStandardRoutes.integration.test.js` (4), `tests/integration/productZraCodeValidation.integration.test.js` (11) — 30 new, plus 2 pre-existing tests corrected to the right class numbers (`tests/unit/zraCodesResolution.unit.test.js`). 311/311 backend tests passing. Frontend `vite build` and `eslint` both clean.

**Live-verified against Numzlab (2026-08-11):** cleared the (now-known-stale, wrong-class) previously-synced `zra_codes` rows, opened Add Product — all three selectors loaded via on-demand sync showing the corrected data (Tax Type: Standard Rated/MTV/Exports/Exempt; Package Unit: Ampoule/Barrel/Box; Quantity Unit: Each/Kilo-Gramme/Litre — confirmed against a direct Postgres query, classes `04`/`17`/`10`). Selected `A`/`BX`/`EA`, submitted — direct DB query confirmed `taxType='A'`, `zraPackageUnit='BX'`, `zraQuantityUnit='EA'` persisted and `zraRegistrationStatus='REGISTERED'` with a real mock-VSDC `resultCd='000'`. Reopened in edit mode — accessibility-tree read confirmed all three selects still showed the correct selected option (`A — Standard Rated`, `BX — Box`, `EA — Each`), i.e. edit-mode preservation works. Test product removed after verification (browser tooling hit a `window.confirm()` native-dialog CDP limitation on the Delete button mid-verification — cleaned up via direct DB delete of that one SKU-matched row instead; catalog count round-tripped 208→209→208).

**⚠️ Partial, not full ✔️** — the item-save endpoint routing defect this row previously described does not exist (corrected above); what remains is genuinely open: no VSDC registration status/error UI beyond the catalog's flat ZRA STATUS badge (the two-layer bar's U7/U8 success/error states aren't really met by a single badge value — no visible resultMsg on failure, no retry action from the UI), and item composition details (item 9\*) are untouched. Both are real, remaining gaps — this item is not being called done. |
| 9\* | Save item composition details | ✔️ | **Built 2026-08-12.** `POST /items/saveItemComposition` — confirmed **OPTIONAL** per the spec text (§ "SAVE ITEM COMPOSITION", `vsdc-extracted.txt:4188`), unlike item 8\*'s item-save which is mandatory; noted here for accuracy, not treated as license to skip it. Purpose per spec: link a finished product (`itemCd`) to a component/ingredient item (`cpstItemCd`) + `cpstQty`, one call per component — the sample request even reuses the same code for both fields, which reads as a lazy example rather than a real constraint, so self-composition is rejected here as a real validation rule. No get/update/delete endpoint exists anywhere in the spec, only "save" — removal is necessarily local-only, surfaced to the user in the UI rather than silently pretending otherwise. New `ProductComposition` model (`prisma/schema.prisma`, migration `20260812043822_item_composition`) — one row per (parent, component) pair, unique constraint, own `zraRegistrationStatus`/`zraRegisteredAt`/`zraRegistrationError` mirroring Product's registration tracking. `endpointAdapter.js` gained `itemComposition` (OFFICIAL `/items/saveItemComposition`, MOCK `/api/items/composition/save`); `mock-vsdc-server.js` handler returns `{resultCd:'000', data:null}` matching the spec's own response sample exactly (no fabricated fields). `services/itemCompositionService.js`: validates parent≠component, quantity>0, both sides have a SKU (itemCd source) before ever calling VSDC; submission failure is recorded (`FAILED` + error message) and rethrown, never silently dropped. Routes on `routes/products.js` as a sub-resource — `GET/POST /api/products/:id/composition`, `DELETE /api/products/:id/composition/:compositionId` — `products:read`/`products:write` gated. Product delete route extended to clean up composition rows in its existing transaction (both parent- and component-side), avoiding the FK violation that would otherwise block deleting a product ever used in a composition. UI: `ItemCompositionModal.jsx` + `ProductPicker.jsx` (type-ahead reusing the existing `GET /api/products?q=` search — no new search endpoint needed for it), a "🧩 Composition" action button per product row (`ProductsTable.jsx`/`ProductsPage.jsx`), full loading/empty/error states, ZRA status badge and error message shown per component. Tests: `tests/unit/itemCompositionService.unit.test.js` (10), `tests/integration/itemComposition.integration.test.js` (7), plus regression coverage in `tests/unit/endpointAdapter.unit.test.js` and `tests/unit/vsdcOfficialRouting.unit.test.js` proving the VSDC call resolves via `endpointAdapter.path('itemComposition')` in both modes — 329/329 backend tests passing. Frontend build + lint clean. **Live-verified against Numzlab (2026-08-12):** created a parent + component product via direct API, added the component through `POST /api/products/:id/composition` — persisted `REGISTERED`, mock VSDC log showed `🧩 Mock VSDC item composition save: TEST-COMP-BUNDLE-1 <- TEST-COMP-PART-1 x 4` at the matching timestamp. Then, through the actual browser UI (not API): opened the Composition modal for the same product, confirmed the existing component displayed correctly (name, SKU, quantity, REGISTERED badge), searched for and added a second component ("Coca-Cola 500ml", qty 2) — appeared in the list immediately with a REGISTERED badge — then removed it via the UI's Remove button and confirmed it disappeared from the list without any further VSDC call. Test products deleted afterward (parent delete confirmed the new composition-cleanup transaction logic works live, not just in tests); catalog count round-tripped 208→210→208. ⚠️ Real ZRA sandbox behavior unverified — no credentials, same caveat as every other item in this document. |
| 10\* | Retrieve saved item details | ✔️ | **Built 2026-08-12.** `POST /items/selectItems` — confirmed **OPTIONAL** per the spec text (same category as item 28\*'s `/stock/selectStockItems`), request `tpin`/`bhfId`/`lastReqDt`. Unlike item 28\*, this endpoint HAS a confirmed JSON response sample in the spec (`data.itemList[]`), so `lib/vsdc-gateway/itemsRetrieveSync.js`'s `extractItemRecords()` expects that shape directly rather than defensively guessing among several, as item 28\*'s `extractStockRecords()` has to. This is an item master list, not an event log — there's no `sarNo`-equivalent identifier — so retrieved data is written as a **snapshot**, not a dedup-keyed row: `Product.zraItemSnapshot` (new `Json?` column, mirroring `Branch.zraBranchSnapshot`'s existing "reference, not authority" pattern, `prisma/schema.prisma:597-604`) is overwritten per matched item on every sync, and operational fields (`name`, `price`, `barcode`, `zraItemClassification`, etc.) are never touched. This fixes a real defect the prior implementation had: `itemManagement.js`'s `updateLocalItemsFromSync` directly overwrote those operational fields from whatever ZRA returned, and separately posted to an invented `/api/items/sync` path (`vsdcService.js`'s own `this.endpoints.itemsSync`) that bypassed `endpointAdapter` entirely — the same failure mode as items 1\*/8\*. Idempotency is structural: because the write is an overwrite, not an insert, no dedup step is required (a real design difference from item 28\*, not an oversight) — a retry after a mid-batch failure simply re-writes the same rows safely. Matching product is resolved by `itemCd` against `Product.sku`; an unmatched `itemCd` is skipped and reported (`unmatchedItemCodes`), never fabricated into a new `Product`. Cursor: new `ItemRetrievalCursor` model (one row per branch, Postgres-persisted), structurally identical to `StockRetrievalCursor` but kept separate rather than shared/generalized, to avoid altering the shipped item 28\* table for a marginal DRY win; initial sync uses the spec's own default (`lastReqDt` "defaults to 20160523000000", confirmed identical text to item 28\*'s default). Routes: `POST /api/vsdc/items/retrieve` (trigger) + `GET /api/vsdc/items/retrieve/status` (cursor/last-run observability), `zra:sync`/`zra:read` gated, named to sit alongside item 28\*'s `/api/vsdc/stock/retrieve*` rather than under `/api/items/*`. **Decommissioned the prior broken implementation**, verified via grep to have no other real callers: `itemManagement.js`'s `syncItemsFromVSDC`/`updateLocalItemsFromSync`/orphaned `getDefaultCategoryId`, `routes/items.js`'s `POST /sync` route, `itemClassificationService.js`'s unused `synchronizeItems` facade, and `vsdcService.js`'s dead `itemsSync` endpoint key. No new frontend UI, same reasoning as item 28\*: none of the backend-only sync siblings (codes sync, branch sync, stock push/pull sync) have UI either. Tests: `tests/unit/itemsRetrieveSync.unit.test.js` (16) + `tests/integration/itemsRetrieveRoute.integration.test.js` (6) + a regression assertion in `tests/unit/endpointAdapter.unit.test.js` — 22 new, 392/392 backend passing (up from 370). **Live-verified against Numzlab (2026-08-12):** confirmed `everSynced:false` before any sync; triggered retrieval — mock log showed `📥 Mock VSDC items select, lastReqDt: 20160523000000` (the real spec default, not invented), the seeded `COKE500` product's `zraItemSnapshot`/`zraSnapshotSyncedAt` were populated while `name`/`price`/`barcode` stayed exactly as they were locally (`Coca-Cola 500ml`/`12`/`600130800002`), and a deliberately-unmatched fixture item was reported in `unmatchedItemCodes` without a new `Product` ever being created; ran a second sync — cursor's `lastReqDt` correctly used its own advanced value (not the spec default) for the incremental request, snapshot rewritten in place with no duplicate rows (proving the no-dedup-needed design); forced a real network failure by stopping the mock-vsdc container mid-request — sync failed with the real `getaddrinfo EAI_AGAIN` error, cursor's `lastReqDt` provably unchanged; restarted mock-vsdc and, separately, restarted the **backend container itself** — cursor value survived the real restart unchanged, confirming it's genuinely Postgres-backed, not in-process state; confirmed the decommissioned `POST /api/items/sync` now returns a real 404. Test artifacts (the cursor row, the `COKE500` snapshot fields) removed from Numzlab afterward, matching item 28\*'s precedent. ⚠️ Real ZRA sandbox response shape is unverified — no credentials, same caveat as every other item in this document; this is the one retrieval endpoint where the *shape itself* is not in doubt (confirmed spec sample), only whether real ZRA data will actually populate every field as shown. |
| | **Import Item Information** | | |
| 11\* | Retrieve import item details | ✖️ | No implementation anywhere |
| 12\* | Update imported item details | ✖️ | No implementation anywhere |
| | **Purchase Information** | | |
| 13\* | Save retrieved purchase information | ✖️ | No implementation anywhere |
| 14\* | Retrieve purchase information | ✖️ | No implementation anywhere |
| 15\* | Manually capture purchase from unregistered supplier | ⚠️ | Functionally possible — `Supplier.tpin` is optional (`prisma/schema.prisma:794`) and a full PO→GRN cycle works (`lib/purchasing.js`); `POST /api/inventory/receive` accepts free-text supplier. But this is internal procurement, **not** a fiscal purchase document, and nothing is transmitted to ZRA. |
| | **Sales Information** | | |
| 16\* | Record and upload sales transactions | ✔️ | `lib/saleFiscal.js:442` → `services/zraInvoice.js:399` → `/trnsSales/saveSales` |
| 17\* | Unique and consecutive invoice numbers per branch | ✔️ | Atomic allocation via `upsert` with increment (`lib/fiscalInvoiceNumber.js:32-36`), compiled to `SET last_invc_no = last_invc_no + 1 RETURNING`, atomic under READ COMMITTED. `vsdcDevice` table holds per-device counter with unique index on `(tpin, bhfId, dvcSrlNo)`. Unique indexes added to `sales.fiscalInvcNo` and `refunds.fiscalInvcNo` per migration `20260810174500_fiscal_error_code`. ⚠️ *Gaps are unavoidable:* a number allocated for a sale that then fails VSDC is burned; `zraInvoice.js:439` guards against retry burns. ⚠️ *Single-branch only:* `deviceKey()` uses `process.env.BRANCH_ID` globally, not `Sale.branchId`; correct for single-branch, wrong if more than one `Branch` row exists. |
| 18\* | Invoice numbers cannot be modified or deleted | ✔️ | No PUT/PATCH/DELETE route for sales exists. `zraInvoice.js:439` guards `fiscalInvcNo` behind `if (!sale.fiscalInvcNo)`. |
| 19\* | Tax invoice minimum features | ✔️ | **Both remaining partials fixed 2026-08-12** — see §3.1 breakdown below; all 18 sub-items now present |
| 20\* | Generate credit notes | ✔️ | `lib/saleRefund.js`; `rcptTyCd='R'` at `payloadBuilders/saveCreditNote.js:7`; `orgInvcNo` linked via `zraInvoice.js:343` |
| 21\* | Generate debit notes | ✔️ | `POST /api/sales/:id/debit-note` (`routes/sales.js`, gated `sales:refund`) → `debitNoteSale()` (`lib/saleDebitNote.js`) → `zraInvoice.js` `submitFiscalForDebitNote()`/`buildDebitNoteFromDebitNote()`, mirroring the credit-note path (`saleRefund.js`). Payload carries `rcptTyCd='D'`, real `dbtRsnCd`/`invcAdjustReason` (`payloadBuilders/saveSales.js:132-175` — previously hardcoded `''` regardless of receipt type). Atomic invoice numbering, duplicate-submission recovery (`007`), and audit logging (`DEBIT_NOTE_CREATE`) all reused from the credit-note pattern. New `DebitNote`/`DebitNoteItem` models, receipt snapshot support (`ReceiptSourceType.DEBIT_NOTE`, `lib/receipt/loaders.js` `buildDebitNoteReceiptSource`). Route-level tests: `tests/integration/debitNote.integration.test.js` (permission gate, successful submission, ZRA-rejection handling, un-fiscalized-sale guard, empty-lines guard, listing). Payload-construction tests: `tests/unit/debitNotePayload.unit.test.js` (rcptTyCd, dbtRsnCd, invcAdjustReason, orgInvcNo, and that an ordinary sale is unaffected). Frontend: `DebitNoteModal.jsx` (`smart-pos-frontend/src/components/sales/`), wired into `SalesPage.jsx` next to Refund. Verified end-to-end against the live Numzlab deployment (`https://pos.lab.numz.site`) — real fiscal submission through the mock VSDC, receipt correctly rendered with "DEBIT NOTE" title, QR code, and VAT breakdown. |
| 22\* | Invoice details cannot be modified after generation | ✔️ | No update route reaches a fiscalized sale. Guard at `lib/saleFiscal.js:374-390`. ⚠️ `completeSaleAfterFiscalSuccess` (`:297`) has no internal status precondition — safe by convention, not construction. |
| 23\* | Invoice details cannot be deleted after generation | ✔️ | No `sale.delete` / `saleItem.delete` outside tests |
| 24\* | Reprints marked COPY/DUPLICATE | ✔️ | Marking works — `lib/receipt/snapshot.js:149-159`, rendered by `receiptSections.ts:4-8`, audit-logged at `routes/receipts.js:37`. Frontend tracks first-print state via `hasPrintedRef` (`CheckoutModal.jsx:197`, `RefundModal.jsx:130`) — first print passes `reprint: false`, reprints pass `true`. |
| 25 | Backup strategy | ✔️ | Scripted with retention (`smart-pos-backend/lib/backup.js:1-95`, `scripts/backup-database.js:1-22`); scheduled interval support (`index.js:110-119`); `BACKUP_CREATE` audit event (`backup.js:64,91`); admin on-demand (`routes/settings.js:61-70`). Documented in `DEPLOY.md:177-206`. *(not mandatory)* |
| 26\* | User authentication with user-level passwords | ✔️ | bcrypt cost 10 (`routes/users.js:107`), JWT (`:194-204`), 4 roles, ~35 permissions (`middleware/auth.js:103-163`), login rate limit (`middleware/rateLimit.js:7`), immediate deactivation (`middleware/auth.js:249-267`) |
| | **Stock Information** | | |
| 27\* | Save stock items, transmit to Smart Invoice | ⚠️ | **Corrected 2026-08-12 — was worse than this row described, not merely "sale path only."** Full forensic trace (not inference) found **two parallel stock-sync systems firing on every sale**: `lib/vsdc-gateway/index.js`'s `postSaleStock()` (triggered inside `submitFiscalForSale` → `submitInvoiceData`, `services/zraInvoice.js:70`) *and* `services/stockSyncService.js`'s `syncAfterSale()` (fired separately from `lib/saleFiscal.js:351`, inside `completeSaleAfterFiscalSuccess`) — both unconditional, same sale, no branch separating them. Both payloads were malformed (no `itemList` wrapper, missing required fields) *and* `stockSyncService`'s `sarTyCd` map was backwards for nearly every movement type (`SALE_OUT` was tagged `'02'` — "Incoming-Purchase" per spec §6.14 — the literal opposite direction). Fixed: removed the duplicate `postSaleStock` path entirely (`stockSyncService` — already wired to sales/refunds/adjustments/inventory-core/expiry — is now the sole source of stock reporting); corrected `MOVEMENT_TYPE_TO_VSDC` against the spec text for all 10 Prisma `StockMovementType` values (`RECOUNT`, which has no dedicated spec code, resolves by direction to the nearest Adjustment code); rebuilt `vsdcService.submitStockIo()`'s payload to the real `itemList`-wrapped shape with the required top-level fields (`orgSarNo`, `regTyCd`, `totTaxblAmt`/`totTaxAmt`/`totAmt`, `ocrnDt` in the spec's `yyyyMMdd` — not `yyyyMMddHHmmss` — format); added the missing paired `saveStockMaster` call (`vsdcService.submitStockMaster()`) using `StockMovement.newStock` as `rsdQty` (the spec wants the *resulting* quantity, not a delta — the field is `stockItemList`, not `itemList`, which the old caller also got wrong). Errors are not swallowed — `stockSyncService.recordAudit()` logs both success and failure to the audit trail; if `saveStockItems` succeeds but `saveStockMaster` fails, the combined failure is recorded and the movement stays un-synced for retry. Tests: `tests/unit/stockSyncService.unit.test.js` (19 — sarTyCd correctness for every movement type, code resolution with product-field vs synced-default fallback, payload shape, the item→master call sequence and its three failure modes), plus a regression in `tests/unit/vsdcSubmitValidation.unit.test.js` proving `submitInvoiceData` no longer touches any stock endpoint. 350/350 backend passing. **Live-verified against Numzlab (2026-08-12):** a real checkout produced exactly one `🧾 sales save` + one `📊 stock save: 11 COKE500` (correct Sale-outgoing code, was `02` before the fix) + one `📊 stock master save: 1 items`, `StockMovement.zraSyncedAt` set with both `item`/`master` VSDC responses recorded. **A second real bug was caught only by this live pass, not by any unit test**: `endpointAdapter.js`'s **mock**-mode map had `stockMaster` aliased to the exact same path as `stockItems` (`/api/stock/save`) — pre-existing, predates this session — so the saveStockMaster call was silently landing on the stockItems handler. Every unit test mocks `vsdcService.makeAuthenticatedRequest` directly, below that resolution layer, so none could have caught a same-URL collision; fixed (`MOCK.stockMaster` now `/api/stock/master/save`, distinct mock handler added), regression test added, re-verified live with a clean, correctly-separated `stock save` / `stock master save` log pair. ⚠️ Still not full ✔️: tax/IPL/TL/excise amounts on the stock-item payload are honestly `0` (not fabricated) since no per-movement tax computation is tracked — VAT on an actual taxable supply is reported separately via `saveSales`; this is a simplification, not verified against a real sandbox. |
| 28\* | Retrieve saved stock items | ✔️ | **Built 2026-08-12.** `POST /stock/selectStockItems` — confirmed **OPTIONAL** per the spec text (not mandatory), `Request Parameters: TPIN, Branch Id, Last Request Date`. The spec provides the full response field list for this endpoint but **no actual JSON response sample** (the sample text adjacent to it in the source PDF belongs to a different, unrelated Import Item endpoint — a page-layout extraction artifact, same class of issue found elsewhere in this document); the exact wrapper key name is therefore unconfirmed, and the parser (`lib/vsdc-gateway/stockRetrieveSync.js` `extractStockRecords()`) accepts several plausible shapes and throws clearly on an unrecognized one rather than silently treating it as empty. The response's field list has no direction/sarTyCd equivalent, so a retrieved quantity's increase-vs-decrease can't be safely inferred — retrieved records are stored as `StockMovementType.RECONCILED` reconciliation snapshots only and **never** applied to `Inventory.currentStock` or fabricated into a real operational movement. Reused the existing `StockMovement` model rather than a new one, per instruction; the two real gaps that came out of that reuse were `userId` (required FK, no natural value for ZRA-originated data — made nullable) and `movementType` (new `RECONCILED` enum value, both minimal, additive migrations, non-destructive to existing rows). Idempotency key is `(referenceType='RECONCILED', referenceId=sarNo, productId)` — `sarNo` is the spec's own Stock Accounting Record Number, the natural identifier it provides; matching product is resolved by `itemCd` against `Product.sku`, and an unmatched `itemCd` is skipped and reported, never fabricated into a local product. Cursor: new `StockRetrievalCursor` model (one row per branch, persisted in Postgres, not the in-memory pattern `services/zraCodesService.js` uses for its own last-sync date) — initial sync uses the spec's own stated default (`lastReqDt` "defaults to 20160523000000"), advances to "now" **only** after every row in the batch is durably persisted or already existed; any HTTP failure, malformed response, or mid-batch persistence failure leaves it untouched, so a retry safely re-requests the same window (safe specifically because already-persisted rows are deduped, not reprocessed). Routes: `POST /api/vsdc/stock/retrieve` (trigger) + `GET /api/vsdc/stock/retrieve/status` (cursor/last-run observability), `zra:sync`/`zra:read` gated — named distinctly from the pre-existing `POST /api/vsdc/stock/sync` (items 27\*/29\*, the opposite *push* direction). No new frontend UI: none of this feature's four closest siblings (codes sync, branch sync, the stock push-sync route) have any UI either — all are backend-only, triggered manually — so building UI for only this one would be the inconsistent choice; the trigger route's own JSON response (`imported`/`skipped`/`unmatched`/`unmatchedItemCodes`) already provides the "observable" requirement. Tests: `tests/unit/stockRetrieveSync.unit.test.js` (14 — request construction, response mapping, initial/incremental sync, duplicate/idempotency, empty response, VSDC rejection, network failure, malformed response, unmatched item, mid-batch DB failure with partial persistence, retry-after-failure reusing the same cursor, cursor read fresh from DB not cached in-process) + `tests/integration/stockRetrieveRoute.integration.test.js` (6 — permission gates, success/failure response shape, status endpoint before/after a real sync). 370/370 backend passing (up from 350). **Live-verified against Numzlab (2026-08-12):** confirmed `everSynced:false` before any sync; triggered retrieval — mock log showed `📥 Mock VSDC stock items select, lastReqDt: 20160523000000` (the real spec default, not invented), one seeded item (`COKE500`) matched and persisted as `RECONCILED` with `userId` null, one deliberately-unmatched item reported in `unmatchedItemCodes` without being fabricated; ran a second time — `imported:0, skipped:1`, DB confirmed exactly one row for that `sarNo`, cursor correctly used its own advanced value (not the spec default) for the incremental request; forced a real network failure by stopping the mock-vsdc container mid-request — sync failed with the real `getaddrinfo EAI_AGAIN` error, cursor's `lastReqDt` provably unchanged, `lastSyncError` recorded; restarted mock-vsdc and, separately, restarted the **backend container itself** — cursor value survived the real restart unchanged, confirming it's genuinely Postgres-backed, not in-process state. Test artifacts (the one `RECONCILED` row, the cursor row) removed from Numzlab afterward. ⚠️ Real ZRA sandbox response shape is unverified — no credentials, and per the spec-extraction gap above, this is the one item in this document where even the *shape* being defended against is inferred, not confirmed; flagged prominently rather than presented as certain. |
| 29\* | Update stock quantities on adjustment | ⚠️ | **Corrected 2026-08-12** — wiring already existed (`routes/inventory/adjustments.js:205`, `stockSyncService.syncMovementById`), the transmission itself was wrong; see item 27\*'s row for the shared fix (sarTyCd mapping, payload shape, saveStockMaster, the mock-path collision). **Live-verified against Numzlab (2026-08-12):** a real `POST /api/inventory/adjust` (INCREASE, qty 5) produced `📊 stock save: 06 COKE500` (correct Adjustment-incoming code) + `📊 stock master save: 1 items`, stock 106→111, `StockMovement.zraSyncedAt` set with both responses recorded. |
| | **Reports** | | |
| 30\* | Reports in Excel, CSV, PDF or MS Access | ✔️ | CSV server-side across tax/profit/shifts/purchasing/user-activity/transactions (`lib/reports.js`, `routes/reports.js:209-250`); PDF for shift X/Z reports (`smart-pos-frontend/src/lib/shiftPdf.js`). Satisfies the "or". |
| 31\* | Basic transaction report | ✔️ | `GET /api/reports/transactions?format=csv` (`routes/reports.js:153-171`) emits invoice no, date, customer, TPIN, value, tax, and goods/services description. Query at `:134-151` joins `SaleItem` and maps product names (`routes/reports.js:165`). |
| 32\* | Audit trail | ✔️ | `audit_logs` table (`prisma/schema.prisma:574-602`), ~50 event types, ~40 wired call sites, SHA-256 integrity hash (`services/auditService.js:500-513`), API `routes/audit.js`, verify endpoint `:73`. ⚠️ Hash does not cover `newValues`/`metadata` and is not chained. No dedicated UI — surfaced via the User Activity report. |

### 3.1 Item 19 — tax invoice minimum features

Three renderers exist: Thermal DOM, A4 DOM, and ESC/POS (the real thermal printer).
**The ESC/POS path — what actually prints at the till — renders less than the screen.**

| Sub-item | Status | Note |
|---|---|---|
| (i) words "TAX INVOICE" prominent | ✔️ | Present all three (`ThermalRenderer.tsx:37`, `A4Renderer.tsx:38`, `buildEscPos.ts:99`). **Fixed 2026-08-12:** ESC/POS title is now wrapped in `cmd(ESC, 0x45, 1)`/`cmd(ESC, 0x45, 0)` (`buildEscPos.ts:98-100`), the same bold on/off pair already used for `TOTAL:`. Manually verified by decoding the built buffer: exactly 2 `ESC E 1` occurrences (title + TOTAL), title bytes correctly bracketed. No test infra exists in `packages/receipt-engine` (confirmed, none added — this fix has no automated test). |
| (ii) supplier TPIN, name, address | ✔️ | All three present on all renderers. ESC/POS at `buildEscPos.ts:100-105` includes TPIN (`:101`), address (`:103-105`). |
| (iii) invoice issue date | ✔️ | Uses `sale.createdAt`, not the ZRA-issued date |
| (iv) invoice number | ✔️ | Rendered on all three. ESC/POS at `buildEscPos.ts:112-113` includes `vm.transaction.invoiceNo` (fiscal invoice number) separately from receipt number. |
| (v) customer TPIN, name, address | ✔️ | CustomerBlock (`types.ts:80-85`) includes all three. Query joins `customer` and `sale.customer.address` (`saleFiscal.js:19-22`); rendered by all three engines (e.g. `ThermalRenderer.tsx:73-77`, `buildEscPos.ts:105-108`). |
| (vi)(a) quantity | ✔️ | `ThermalRenderer.tsx:80` |
| (vi)(b) price | ✔️ | `:81` |
| (vi)(c) tax-exclusive amount per line | ✔️ | Value present. **Fixed 2026-08-12:** ESC/POS previously had no column label anywhere on the printed path (the screen renderers already had a proper `<th>TOTAL</th>` header, `ThermalRenderer.tsx:66-72`) — added a static `"  Qty   Price       Total"` line before the item loop (`buildEscPos.ts:117`), verified present in the decoded buffer immediately before the first item line. |
| (vii) tax rate(s) | ✔️ | Per-line rates computed from actual tax and taxable amounts at `lib/receipt/loaders.js:52-65`. Breakdown surfaced as `vatBreakdown: VatBreakdownEntry[]` (`types.ts:43-48`) to all three renderers; each rate printed separately. |
| (viii)(a) total exclusive | ✔️ | Labelled "Subtotal" |
| (viii)(b) discount rate **and** amount | ✔️ | Amount computed as `totals.discount = (sale.subtotal || 0) - (sale.subtotal - sale.discountAmt)` and rate as `computeDiscountRate()` (`loaders.js:67-70`). Both surface via `TotalsBlock` (`types.ts:50-59`) with `discountRate` and `discount` fields. All renderers display both. |
| (viii)(c) total tax | ✔️ | |
| (viii)(d) total inclusive | ✔️ | |
| (ix)(a) QR code | ✔️ | `ThermalRenderer.tsx:134-139`, native `GS ( k` at `buildEscPos.ts:151-153` |
| (ix)(b) SDC ID | ✔️ | `ThermalRenderer.tsx:125` |
| (ix)(c) invoice type | ✔️ | Mapped via `receiptSections.ts:10-23` — `receiptTitle()` returns "TAX INVOICE"/"CREDIT NOTE"/"DEBIT NOTE"/"PROFORMA INVOICE"/"PURCHASE INVOICE" based on `vm.receiptMeta.receiptType`. Rendered at top of all three receipt engines. |
| (ix)(d) VSDC date | ✔️ | Parsed at `lib/vsdc-gateway/index.js:21` and persisted at `saleFiscal.js:318` as `vsdcRcptPbctDate`, converted via `parseVsdcDate()` `:291-295`. Rendered by all three receipt engines (e.g. `A4Renderer.tsx:67-69`). |
| (ix)(e) internal data **and** fiscal signature | ✔️ | Stored separately: `saleFiscal.js:314-315` writes `rcptSign` and `intrlData` as distinct columns; both surface through `lib/receipt/loaders.js:90-92` to `FiscalBlock` (`types.ts:86-90`) and all three renderers (Thermal, A4, ESC/POS `buildEscPos.ts:154-156`). |

---

## SECTION 4: STATUS LEGEND

| Symbol | Meaning |
|--------|---------|
| ✔️ | Implemented and evidenced in code |
| ⚠️ | Partially implemented — see note |
| ✖️ | Not implemented, or implemented only against the mock VSDC |
| N/A | Not applicable |

---

## Known defects affecting already-submitted data

Two bugs affect invoices **already transmitted to ZRA** and should be treated as higher priority
than any missing endpoint:

1. **Duplicate invoice numbers are possible.** `lib/fiscalInvoiceNumber.js:43`. No unique index
   exists to catch it.
2. **Fiscal signatures were never stored.** `lib/saleFiscal.js:302`. Every fiscalized sale to date
   has `intrlData` in the `rcptSign` column. Recovery is possible — `Sale.vsdcResponse` retains the
   original VSDC payload.
