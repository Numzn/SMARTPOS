# Codebase audit — errors & inconsistencies

Last updated: third hardening pass (checkout + cleanup).

## Resolved (current pass)

| Issue | Fix |
|-------|-----|
| Cluttered, multi-state checkout | Rewritten `src/components/CheckoutModal.jsx`: 3 clear steps (method → details → confirm) + receipt. Keyboard shortcuts (`1–4` to pick method, `ESC` to cancel), inline ZRA submission state, change calculation, validation per method. |
| Duplicate cashier UI tree | Removed legacy `components/cashier/` siblings (`CashierDashboard`, `CashierTabs`, `CashierHeader`, `StatusBar`, `components/*`, `tabs/*`) and the orphaned `hooks/useCashierStore.js`. Canonical lives at `components/cashier/modern/*`, routed via `pages/CashierPage.jsx`. |
| SQLite-era Prisma migrations | History reset: single `20260526000000_baseline_postgres` baseline generated from `schema.prisma`, marked applied with `prisma migrate resolve`. `migrate status` reports up to date. |
| `stockSyncService` schema drift | Rewritten as a clean, schema-aligned module. Maps real `StockMovementType` enum → VSDC codes, reads from live `stock_movements`, calls `vsdcService.submitStockIo` only if implemented (otherwise dry-run), and logs through `auditService`. No invented fields. |

## Previous pass (kept resolved)

| Issue | Fix |
|-------|-----|
| Dual stock-adjust write paths | Single canonical write path: `POST /api/inventory/adjust`. Accepts both operational (`IN`/`OUT`) and ZRA-style (`INCREASE`/`DECREASE`/`DAMAGED`/`EXPIRED`/`RECOUNT`) types. Writes Inventory + StockMovement + InventoryBatch + StockAdjustment in one transaction. |
| Legacy `POST /api/stock-adjustments` | Returns `410 Gone` with `Deprecation` + `Link` headers pointing to canonical endpoint. GET history endpoints remain. |
| ZRA audit trail on adjustments | `StockAdjustment` rows now written on every adjustment (including bulk). |
| Frontend lint failing | `npm run lint` is now clean (no errors, no warnings). |
| Compliance checker drift | `compliance-checker.js` computes effective status against filesystem. Bad refs (`invoiceService.js`, `sessionService.js`) replaced with real files. |
| Hardcoded `localhost:4000` in LoginForm | Uses `API_ROOT` from `apiClient` (driven by `VITE_API_URL`). |
| `VIEWER` role mismatch | Added to Prisma `Role` enum, applied with `prisma db push`. |
| Movement report wrong enum types | `routes/inventory/reports.js` uses `PURCHASE_IN`/`SALE_OUT`/etc. |
| Multiple `PrismaClient` instances | Backend services now share `lib/prisma.js`. |

## Earlier passes (kept resolved)

- `product.stock` on wrong model → uses `Inventory` everywhere.
- `markBatchExpired` referenced undefined `response` → fixed.
- Products API exposes `stock` alias for cashier UI.
- Removed unused `HealthCheck.jsx`.
- `productService.js` migrated to `apiFetch` / `VITE_API_URL`.

## Still open (low priority)

| Issue | Notes |
|-------|--------|
| Legacy gradient CSS on a few pages | `index.css` still defines older classes; harmless but worth pruning. |
| Compliance docs prose | Some prose still references older module names; the runtime checker is now self-correcting. |

## Canonical contracts

### Stock adjustment (single write path)

`POST /api/inventory/adjust`

```json
{
  "productId": "...",
  "adjustmentType": "IN | OUT | INCREASE | DECREASE | DAMAGED | EXPIRED | RECOUNT",
  "quantity": 5,
  "reason": "string (optional)",
  "unitCost": 0,
  "occurrenceDate": "ISO date (optional)",
  "branchId": "main"
}
```

Returns updated `inventory`, `stockMovement`, `stockAdjustment`, plus
`adjustmentDirection` (`IN`/`OUT`) and normalized `adjustmentType`.

### Audit history (read-only)

- `GET /api/stock-adjustments` — list ZRA audit records
- `GET /api/stock-adjustments/:id`
- `GET /api/stock-adjustments/product/:productId`
- `GET /api/inventory/history` — operational movements (paginated)

### Auth

- Login: `POST /api/users/login` → `{ token, user }`
- Storage: cookie + `localStorage`
- Calls: `Authorization: Bearer <token>` (set automatically by `apiClient`)

## Checkout flow (canonical)

1. **Method** — pick `Cash`, `Card`, `Mobile`, or `Bank` (shortcuts `1`–`4`); optional customer name/phone.
2. **Details** — method-specific input only: cash received + live change, card last-4, mobile number, or bank-transfer confirmation. Continue button is disabled until the input is valid (e.g. cash ≥ total).
3. **Confirm** — itemised review with subtotal / VAT 16% / total and the chosen payment summary, then `Complete payment`. Calls `POST /api/sales` once, then `POST /api/zra/send-invoice/:saleId`.
4. **Receipt** — sale id, change due (if any), and ZRA submission state (`Submitted` with receipt no., `Failed — will retry`, or `Pending`). `Print receipt` triggers the browser print, `New sale` clears the cart and closes.

`ESC` cancels at any step except the receipt. The cart total is always shown in the header, so the operator never loses sight of the amount due.

## Docker stack (added this pass)

Run the entire stack with one command from the repo root:

```bash
npm run docker:up      # build + start postgres, mock-vsdc, backend, frontend
npm run docker:logs    # tail all services
npm run docker:down    # stop containers (volume kept)
npm run docker:reset   # stop + drop the Postgres volume (fresh DB next time)
```

Services exposed (override ports in `.env` next to `docker-compose.yml`, see `.env.docker.example`):

| Service     | URL                              | Notes |
|-------------|----------------------------------|-------|
| Frontend    | http://localhost:8080            | nginx, SPA fallback, proxies `/api/*` → backend |
| Backend     | http://localhost:4000/api/health | runs `prisma migrate deploy` then seeds on first boot |
| Mock VSDC   | http://localhost:8090/health     | shares the backend image, alternate command |
| Postgres    | localhost:5432                   | persisted in named volume `smart_pos_pg_data` |

Design notes:
- Frontend bundle is built with `VITE_API_URL=/api` so the SPA stays **same-origin** — no CORS, no runtime env injection.
- Backend image is multi-stage (deps → runtime), runs as a non-root `nodejs` user, with `tini` as PID 1.
- Entrypoint waits for Postgres, applies migrations (`prisma migrate deploy`), and seeds **only when the database has zero users** so re-runs are idempotent.
- Mock VSDC reuses the backend image with `command: ["node", "mock-vsdc-server.js"]` — no duplicate Dockerfile.
- The legacy `smart-pos-backend/docker-compose.yml` (Postgres-only) is kept for the `npm run db:up` workflow when you'd rather run the apps natively.

## Health gates

- `smart-pos-frontend`: `npm run lint` ✅
- `smart-pos-frontend`: `npm run build` ✅
- `smart-pos-backend`: `npx prisma migrate status` ✅ (single Postgres baseline)
- `smart-pos-backend`: `npm run validate:system` ✅
- `smart-pos-backend`: `npm run validate:frontend` ✅
- `smart-pos-backend`: `node scripts/verify-adjust-consolidation.js` ✅
- `smart-pos-backend`: `npm run compliance` ✅ (status reflects filesystem)
- Root: `docker compose config --services` ✅ (postgres, mock-vsdc, backend, frontend)
