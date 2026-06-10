# Smart POS Backend — Architecture & Flows

## System context

```
smart-pos-frontend (:5173)
        │  JWT + REST
        ▼
smart-pos-backend (:4000)
        │
        ├── Prisma → PostgreSQL (self-hosted, see docs/DATABASE.md)
        └── vsdcService → VSDC / mock (:8090)
```

## Layering

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Routes | `routes/*.js` | HTTP, auth guards, request validation |
| Services | `services/*.js` | ZRA/VSDC, audit, item/stock sync |
| Lib | `lib/*.js` | Prisma client, inventory helpers |
| Data | `prisma/schema.prisma` | Domain models |

## Authentication flow

1. `POST /api/users/login` — email + password → bcrypt compare → JWT (`JWT_SECRET`).
2. Protected routes send `Authorization: Bearer <token>`.
3. `middleware/auth.js` verifies JWT, loads user, attaches `permissions` by role.

Roles: `ADMIN` > `MANAGER` > `CASHIER` (see `PERMISSIONS` in auth middleware).

## Sale lifecycle (core POS)

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant API as POST /api/sales
    participant DB as PostgreSQL
    participant Inv as inventoryStock

    FE->>API: userId, items[], paymentMethod
    API->>DB: Begin transaction
    API->>DB: Create Sale + SaleItems (VSDC amounts)
    loop Each line item
        API->>Inv: deductStockForSale()
        Inv->>DB: Inventory.currentStock -= qty
        Inv->>DB: StockMovement SALE_OUT
    end
    API->>DB: Commit
    API->>FE: Sale + items (rcptNo null)
```

**Stock:** `lib/inventoryStock.js` updates `Inventory` per `productId` + `branchId` (default `main`). Fails the whole sale if stock is insufficient.

**Tax on lines:** Uses each product’s `taxRate` (default 16%) to fill `splyAmt`, `taxblAmt`, `taxAmt`, `totAmt` on `SaleItem`.

## ZRA Smart Invoice flow

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant ZRA as POST /api/zra/send-invoice/:id
    participant Svc as zraInvoice.sendToVSDC
    participant VSDC as vsdcService
    participant Mock as mock-vsdc :8090

    FE->>ZRA: Bearer token (zra:submit)
    ZRA->>Svc: saleId
    Svc->>Svc: Load Sale + saleItems + product
    alt Already has rcptNo
        Svc->>FE: success (idempotent)
    else Pending
        Svc->>VSDC: initialize() → login
        VSDC->>Mock: POST /api/login
        Svc->>VSDC: submitInvoice (retry)
        VSDC->>Mock: POST /api/invoice/submit
        Mock->>VSDC: rcptNo, qrCode, intrlData
        Svc->>Svc: Update Sale.rcptNo, qrCode, vsdcTimestamp
        Svc->>FE: sale + zraResponse
    end
```

**Pending queue:** `GET /api/zra/pending-sales` — `Sale` where `status = COMPLETED` and `rcptNo` is null.

**Status:** `GET /api/zra/receipt-status/:saleId`.

**Env:** Copy `.env.example` → `.env`. Run mock: `npm run mock-vsdc`.

## Inventory receive flow

`POST /api/inventory/receive` (in `routes/inventory/core.js`):

- Upserts `Inventory` for branch
- Creates `InventoryBatch` (optional expiry)
- Records `StockMovement` type `PURCHASE_IN`

## Data model highlights

- **Product** — catalog + ZRA classification fields (`zraItemClassification`, `taxType`, `taxRate`, units).
- **Sale / SaleItem** — transaction; line items carry VSDC monetary fields.
- **Inventory** — `currentStock` per product per branch (not on `Product`).
- **Invoice** — separate ZRA submission audit table (used by `submitInvoice` path).

## Compliance tooling

- `npm run compliance` — checklist runner
- `docs/implementation-summary.md` — feature completion tracker
- `docs/zra-compliance-checklist.md` — requirements list

## Local development

```bash
cp .env.example .env
npm install
npm run db:up        # Postgres via Docker (or use your own server)
npm run setup-db
npm run mock-vsdc    # terminal 1
npm run dev          # terminal 2
```

Database details: [DATABASE.md](./DATABASE.md)

Default API: `http://localhost:4000/api/health`

## Known follow-ups

- Walk-in sales use default customer name; B2B sales may need explicit `customerTpin` on the sale model later.
- Reporting, purchases, and credit notes remain per compliance roadmap.
- Item registration is centralized in `lib/productRegistration.js` + `services/itemManagement.js`; `itemClassificationService` is a thin compatibility facade.
