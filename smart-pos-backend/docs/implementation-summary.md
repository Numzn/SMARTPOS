# Smart POS — Implementation Module Map

**Authoritative status:** [STATUS.md](../../STATUS.md) (three-lens scorecard, gaps, roadmap).

This document maps canonical code locations. It does not claim VSDC certification completeness.

---

## Core fiscal flows

| Concern | Module | Notes |
|---------|--------|-------|
| Fiscal checkout | `lib/saleFiscal.js` | `POST /api/sales/checkout` — gates, reserve, VSDC, deduct |
| Refunds / credit notes | `lib/saleRefund.js` | Partial refunds, prorated discount, stock restore |
| Stuck sale recovery | `lib/fiscalReconcile.js` | Orphan `FISCAL_SUBMITTING` reconciliation |
| Sequential invoice numbers | `lib/fiscalInvoiceNumber.js` | Per-branch `fiscalInvcNo` |
| Product registration gates | `lib/productRegistration.js` | Blocks checkout for unregistered items |

## Inventory

| Concern | Module | Notes |
|---------|--------|-------|
| Stock reserve / deduct | `lib/inventoryStock.js` | `SELECT FOR UPDATE`, `reservedStock` |
| VSDC stock sync | `services/stockSyncService.js` | Bulk adjust, mark-expired → `syncAfterMovements()` |
| Receive stock | `routes/inventory/core.js` | `POST /api/inventory/receive` |

## ZRA / VSDC

| Concern | Module | Notes |
|---------|--------|-------|
| Invoice submission | `services/zraInvoice.js` | `submitFiscalForSale()`, legacy retry routes |
| VSDC HTTP client | `services/vsdcService.js` | Session, retries, mock/production URL |
| Item management | `services/itemManagement.js` | Registration with VSDC |
| Mandatory codes | `services/zraCodesService.js` | Partial; offline cache incomplete |

## Branches & auth

| Concern | Module | Notes |
|---------|--------|-------|
| Default branch | `lib/ensureDefaultBranch.js` | Ensures `main` branch exists |
| Branch CRUD | `routes/branches.js` | Prisma `Branch` model |
| JWT + permissions | `middleware/auth.js`, `routes/users.js` | Role-based route guards |

## Routes (HTTP entry points)

| Route file | Primary endpoints |
|------------|-------------------|
| `routes/sales.js` | `/checkout`, gated `POST /` |
| `routes/zra.js` | Manual resubmit, pending sales, receipt status |
| `routes/branches.js` | Branch management |
| `routes/products.js` | Product catalog |
| `routes/inventory/` | Stock receive, adjust, expiry |

## Validation

```bash
docker exec smart-pos-backend node scripts/validate-system.js
```

Expected: **24/24 PASS** against mock VSDC.

## Related docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) — sequence diagrams and layering
- [zra-compliance-checklist.md](./zra-compliance-checklist.md) — VSDC requirement detail
- [DATABASE.md](./DATABASE.md) — Postgres and migrations
