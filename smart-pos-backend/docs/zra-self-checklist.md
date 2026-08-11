# Smart Invoice VSDC — Developer Self-Checklist

**System:** SmartPOS · **Version:** 1.0.0 · **Assessed:** 2026-08-11
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

## Headline

| | Count |
|---|---|
| Checklist endpoints implemented against the **official** path | **5 of 17** |
| Mandatory functional items passing | **16 of 27** |
| Mandatory functional items partial | **2** |
| Mandatory functional items failing | **9** |

The single most important structural finding: **`VSDC_MODE=official` does not put device
initialisation or item registration onto official paths.** Both have an official constant defined in
`lib/vsdc-gateway/endpointAdapter.js` that is never passed to `path()`; the live calls use hardcoded
mock paths. Only 6 of the 10 adapter keys are ever used (`codes`, `itemClass`, `salesSave`,
`salesSelect`, `stockItems`, `stockMaster`) — verified by exhaustive grep of `lib/`, `services/`, `routes/`.

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
| 1 | Device Initialisation | `/initializer/selectInitInfo` | ✖️ **constant defined, never called** |
| 2 | Get Code Data | `/code/selectCodes` | ✔️ |
| 3 | Get Branch Customers | `/branches/selectBranchCustomers` | ✖️ absent |
| 4 | Save Branch Customer | `/branches/saveBrancheCustomers` | ✖️ absent |
| 5 | Item Class | `/itemClass/selectItemsClass` | ✔️ |
| 6 | Save Branch User | `/branches/saveBrancheUsers` | ✖️ absent |
| 7 | Get Branch Information | `/branches/selectBranches` | ✖️ absent |
| 8 | Save Item Information | `/items/saveItem` | ✖️ **constant defined, never called** |
| 9 | Get Item List | `/items/selectItems` | ✖️ absent |
| 10 | Get Import Items | `/imports/selectImportItems` | ✖️ absent |
| 11 | Update Import Item | `/imports/updateImportItems` | ✖️ absent |
| 12 | Save Sales | `/trnsSales/saveSales` | ✔️ |
| 13 | Get Purchases | `/trnsPurchase/selectTrnsPurchaseSales` | ✖️ absent |
| 14 | Get Stock Item List | `/stock/selectStockItems` | ✖️ absent |
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

For endpoints 1, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14 and 17, **all eight sub-items are ✖️** — there is
nothing to assess. Detail on the two that look implemented but are not:

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
| 1\* | Initialize with Smart Invoice via VSDC | ✖️ | Runs against mock path `/api/initialize`, not `/initializer/selectInitInfo`. See §2.2. |
| | **Get Code Data** | | |
| 2\* | Retrieve code data (VSDC constants) | ✔️ | `lib/vsdc-gateway/codesSync.js:17-56`; route `routes/vsdc.js:69` |
| | **Classification Codes** | | |
| 3\* | Retrieve and save classification codes | ✔️ | `codesSync.js:58-93` |
| | **Branch Information** | | |
| 4 | Save branch customer details | ✖️ | Endpoint absent |
| 5 | Retrieve branch customer details | ✖️ | Endpoint absent |
| 6 | Save branch user details | ✖️ | Endpoint absent |
| 7\* | Retrieve registered branch details | ✖️ | Non-spec path, mock only. See §2.2. |
| | **Item Information** | | |
| 8\* | Save item details, transmit via VSDC | ✖️ | Mock path only. See §2.2. |
| 9\* | Save item composition details | ✖️ | No implementation anywhere |
| 10\* | Retrieve saved item details | ✖️ | `/items/selectItems` absent. A sync exists (`itemManagement.js:158`) but posts to invented `/api/items/sync`. |
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
| 19\* | Tax invoice minimum features | ⚠️ | See §3.1 breakdown below — 16 of 18 sub-items present; 2 partial (title not bold, line amounts unlabelled) |
| 20\* | Generate credit notes | ✔️ | `lib/saleRefund.js`; `rcptTyCd='R'` at `payloadBuilders/saveCreditNote.js:7`; `orgInvcNo` linked via `zraInvoice.js:343` |
| 21\* | Generate debit notes | ✖️ | **Not reachable — no route exists.** Model (`DebitNote`, `DebitNoteItem` in `schema.prisma`) and a service layer (`lib/saleDebitNote.js`, `zraInvoice.js:864-877` `submitDebitNote()` with `rcptTyCd='D'`) were added, but there is no HTTP route mounting them, no UI, and no test coverage — nothing in the running app can create a debit note. `dbtRsnCd`/`invcAdjustReason` in the *sales* payload builder (`payloadBuilders/saveSales.js:173-174`, the ordinary sale path) are still hardcoded `''`; unaffected by the new debit-note-specific path. Applying the same standard used elsewhere in this document (unreachable code doesn't count), this stays ✖️ until a route exists and is tested. |
| 22\* | Invoice details cannot be modified after generation | ✔️ | No update route reaches a fiscalized sale. Guard at `lib/saleFiscal.js:374-390`. ⚠️ `completeSaleAfterFiscalSuccess` (`:297`) has no internal status precondition — safe by convention, not construction. |
| 23\* | Invoice details cannot be deleted after generation | ✔️ | No `sale.delete` / `saleItem.delete` outside tests |
| 24\* | Reprints marked COPY/DUPLICATE | ✔️ | Marking works — `lib/receipt/snapshot.js:149-159`, rendered by `receiptSections.ts:4-8`, audit-logged at `routes/receipts.js:37`. Frontend tracks first-print state via `hasPrintedRef` (`CheckoutModal.jsx:197`, `RefundModal.jsx:130`) — first print passes `reprint: false`, reprints pass `true`. |
| 25 | Backup strategy | ✔️ | Scripted with retention (`smart-pos-backend/lib/backup.js:1-95`, `scripts/backup-database.js:1-22`); scheduled interval support (`index.js:110-119`); `BACKUP_CREATE` audit event (`backup.js:64,91`); admin on-demand (`routes/settings.js:61-70`). Documented in `DEPLOY.md:177-206`. *(not mandatory)* |
| 26\* | User authentication with user-level passwords | ✔️ | bcrypt cost 10 (`routes/users.js:107`), JWT (`:194-204`), 4 roles, ~35 permissions (`middleware/auth.js:103-163`), login rate limit (`middleware/rateLimit.js:7`), immediate deactivation (`middleware/auth.js:249-267`) |
| | **Stock Information** | | |
| 27\* | Save stock items, transmit to Smart Invoice | ⚠️ | Sale path only, errors swallowed, ledger sync uses mock path. See §2.1. |
| 28\* | Retrieve saved stock items | ✖️ | `/stock/selectStockItems` absent |
| 29\* | Update stock quantities on adjustment | ⚠️ | Internally yes — full ledger (`StockMovement`, `prisma/schema.prisma:393`) across all six write paths. Transmission to ZRA goes through `vsdcService.submitStockIo`, which targets the **mock** path in official mode. |
| | **Reports** | | |
| 30\* | Reports in Excel, CSV, PDF or MS Access | ✔️ | CSV server-side across tax/profit/shifts/purchasing/user-activity/transactions (`lib/reports.js`, `routes/reports.js:209-250`); PDF for shift X/Z reports (`smart-pos-frontend/src/lib/shiftPdf.js`). Satisfies the "or". |
| 31\* | Basic transaction report | ✔️ | `GET /api/reports/transactions?format=csv` (`routes/reports.js:153-171`) emits invoice no, date, customer, TPIN, value, tax, and goods/services description. Query at `:134-151` joins `SaleItem` and maps product names (`routes/reports.js:165`). |
| 32\* | Audit trail | ✔️ | `audit_logs` table (`prisma/schema.prisma:574-602`), ~50 event types, ~40 wired call sites, SHA-256 integrity hash (`services/auditService.js:500-513`), API `routes/audit.js`, verify endpoint `:73`. ⚠️ Hash does not cover `newValues`/`metadata` and is not chained. No dedicated UI — surfaced via the User Activity report. |

### 3.1 Item 19 — tax invoice minimum features

Three renderers exist: Thermal DOM, A4 DOM, and ESC/POS (the real thermal printer).
**The ESC/POS path — what actually prints at the till — renders less than the screen.**

| Sub-item | Status | Note |
|---|---|---|
| (i) words "TAX INVOICE" prominent | ⚠️ | Present all three (`ThermalRenderer.tsx:37`, `A4Renderer.tsx:38`, `buildEscPos.ts:98`) but ESC/POS prints it at normal size — no double-height/bold |
| (ii) supplier TPIN, name, address | ✔️ | All three present on all renderers. ESC/POS at `buildEscPos.ts:100-105` includes TPIN (`:101`), address (`:103-105`). |
| (iii) invoice issue date | ✔️ | Uses `sale.createdAt`, not the ZRA-issued date |
| (iv) invoice number | ✔️ | Rendered on all three. ESC/POS at `buildEscPos.ts:112-113` includes `vm.transaction.invoiceNo` (fiscal invoice number) separately from receipt number. |
| (v) customer TPIN, name, address | ✔️ | CustomerBlock (`types.ts:80-85`) includes all three. Query joins `customer` and `sale.customer.address` (`saleFiscal.js:19-22`); rendered by all three engines (e.g. `ThermalRenderer.tsx:73-77`, `buildEscPos.ts:105-108`). |
| (vi)(a) quantity | ✔️ | `ThermalRenderer.tsx:80` |
| (vi)(b) price | ✔️ | `:81` |
| (vi)(c) tax-exclusive amount per line | ⚠️ | Value present, unlabelled |
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
