# Project Context

## Purpose and scope
An ERP system for a refurbished-electronics reseller operating under two buying/payment entities, **Digitalbluez** and **Techtenth** (these are `purchased_by_type` values on purchases and `payment_account` values on sales — not vendors; they represent which of the business's own bank accounts/entities a transaction ran through). The business buys used laptops/desktops/monitors, grades and refurbishes them, and resells them, plus deals in accessories (mice, bags, chargers, RAM, SSDs) and offers repair/replacement/return service on both its own stock and customer-owned devices.

The system replaces manual Excel/Google Sheets tracking (Current Stock, Sold Stock, Accessories, Sold Accessories, Repair/Replacement sheets) with a structured web app, while the owner reconciles a large backlog of historical purchase data separately and by hand.

## System architecture
- **Frontend**: Next.js 16 App Router, all pages under `app/dashboard/**`, client components (`'use client'`) doing `fetch`-based calls to the app's own API routes via `lib/api-client.ts`'s `apiFetch` (adds the Bearer token automatically).
- **Backend**: Next.js API routes under `app/api/**/route.ts`. Nearly all of them use `supabaseAdmin` (`lib/supabase/service.ts`, service-role key) to read/write, meaning **Postgres RLS is not the real access-control boundary** for most tables — the route handler's own role check is.
- **Auth**: Supabase Auth. `lib/auth/session.ts` resolves the current user + role two ways: `getSessionUser(req)` reads a Bearer token (used by API routes, called from client via `apiFetch`), `getCookieSessionUser()` reads the session cookie (used by server components). `isOwner()` is a TypeScript type-guard over the resolved session.
- **Roles**: `owner` and `employee`, stored in `public.profiles(id, full_name, role, is_active)`, one row per `auth.users` row. No `middleware.ts` exists — page-level redirects (`components/RequireOwner.tsx`) are UX convenience only; every sensitive route re-checks role itself.
- **Redaction**: `lib/auth/redact.ts` has a `SENSITIVE_FIELDS` map per "shape" (`sku_master`, `stock_list`, `accessories`) and strips those keys from arrays/objects before an `employee`-role response goes out. New employee-facing routes are written to never `.select()` sensitive columns in the first place rather than fetch-then-strip.

## Major modules and relationships

```
SKU Master (sku_master) ──┐
                           ├─→ asset_ledger (one row per physical unit)
Purchase Orders ───────────┘        │
  └─ purchase_order_items           ├─→ sales (one row per sale, unit or accessory)
  └─ purchase_invoices (invoices)   │     └─→ invoices (invoice_type='sales')
                                    ├─→ repair_jobs (repair / replacement / return-adjacent)
                                    └─→ asset_rma_events (vendor returns, customer returns)

accessories ──→ accessory_movements (in/out/adjustment ledger)
customers ──→ sales, repair_jobs, invoices
vendors ──→ purchase_orders, asset_ledger.vendor_id
custom_options ──→ every owner-curated dropdown list (CPU, RAM, storage, screen size, staff names)
```

### Stock/asset lifecycle (`asset_ledger`)
One row per physical unit. Key columns: `sku_id`, `asset_number` (nullable — see below), `serial_number`, `status`, `qc_grade`/`qc_status`, `source`, `po_id`/`po_item_id`, `cost_price`/`vendor_id`/`gst_percentage`, `entered_by`, `received_at`/`reserved_at`/`sold_at`.

`status` values actually used: `qc_pending → qc_passed/ready_for_sale → sold`, plus `faulty`, `rma_sent`, `rma_returned`, `scrapped`. (`draft`, `reserved`, `in_stock`, `pending_sale`, `pending_replacement` exist in the CHECK constraint for historical/backward-compat reasons but are not written by current code paths.)

`source` values: `purchase_order` (unit created via the PO wizard, already had cost/vendor at creation), `legacy_purchase` (migrated from the old flat `purchases` table), `employee_intake` (created via the new Stock Intake screen — no cost/vendor/asset_number at creation).

### Two parallel "views" of the same table, by design
`asset_ledger` is one table, but the app deliberately splits it into two non-overlapping presentations:
- **Live Stock** (`/dashboard/live-stock`, both roles) — `source='employee_intake'` only. This is the day-to-day operational view employees use for Sell/Service.
- **Stock (Main ERP)** (`/dashboard/stock`, owner-only) — `source != 'employee_intake'`. This is where the owner is manually reconciling the historical/legacy backlog, kept isolated so new employee activity never gets mixed into that reconciliation work.

Both are rendered by the same `components/StockView.tsx`, parameterized by a `sourceMode` prop — not two copies of the same code.

### Purchasing (two historical entry doors, one shared ledger)
1. **Purchase Orders** (`purchase_orders → purchase_order_items → asset_ledger → invoices`, `invoice_type='purchase'`): SKU-driven, draft → submit (reserves asset numbers) → receive → invoice.
2. **Legacy quick-entry** (`purchases` table, 763 historical rows, largely superseded): flat one-row-per-unit form. Migrated into `asset_ledger` with `source='legacy_purchase'`.
3. **Employee intake** (`/dashboard/entry/intake` → `POST /api/stock-intake`): the current default way new stock enters the system. No PO required at entry time — `asset_number` stays `NULL` until the owner runs `POST /api/purchase-orders/from-intake` to adopt a batch of intake units into a real PO (this is the *only* place these units get numbered, and it can happen at any time relative to QC/sale, including after the unit is already sold).

### Sales (`sales`, `invoices` where `invoice_type='sales'`)
Employee records a sale via `/dashboard/entry/sell` → `POST /api/sales-entry`. This is final immediately: the unit (or accessory) leaves stock at that moment (status → `sold`, `stock_movements`/`accessory_movements` write immediately). The GST invoice is separate, deferred bookkeeping: owner calls `POST /api/sales/[id]/finalize` whenever, which mints the invoice and marks `sales.finalized=true` — it does **not** touch inventory again (that already happened at sale time).

Payment tracking is independent of invoicing: `sales.payment_status` (`pending`/`partial`/`paid`), `amount_paid`, `payment_account` (which of Digitalbluez/Techtenth/Cash received the money — orthogonal to `sale_type` GST/Cash), and `sold_by` (plain text staff name for incentive attribution, not tied to a login account).

The **Sales Ledger** (`/dashboard/sales`, owner-only) is the transactional/financial view of every sale (payment state, invoice status, editable). This is distinct from the **Sold Stock** tab on Live Stock/Stock (inventory/warranty view — "which unit, sold when, to whom").

### Accessories (`accessories`, `accessory_movements`)
Simple catalog + movement ledger (mirrors the `stock_movements` pattern: `movement_type` in/out/adjustment/return_in, trigger-maintained `quantity` on the parent row, hard-errors on oversell rather than clamping). Anyone can flag a new accessory type at point of sale (lands `review_status='pending_review'`, zero cost); only the owner activates it with real cost/supplier data (`/dashboard/accessories`).

### Repair / Replacement / Return (`repair_jobs`, `asset_rma_events`)
`repair_jobs.job_type` ∈ `('repair','replacement')`, `is_own_stock` boolean (our unit vs. customer's own device). A `replacement` job swaps in one of our units for the customer's broken one — that swapped-in unit is marked `sold` **immediately** at job creation (same "live" principle as a sale), not gated behind owner approval. `status`/`payment_status`/`payment_account`/`amount_charged`/`amount_paid` track the job itself, separately from inventory state.

Customer/vendor returns use the older, separately-built `asset_rma_events` table (`direction` = `'to_vendor'` or `'from_customer'`) via `/api/rma` — vendor returns are owner-only (touch vendor identity); customer returns (Return sub-tab in `/dashboard/entry/service`) are open to both roles and simply move the unit back into the QC funnel.

## Roles and permissions summary
| Action | Employee | Owner |
|---|---|---|
| Stock intake, QC, Sell, Service (repair/replacement/customer-return) | ✅ | ✅ |
| See cost price / vendor / margin anywhere | ❌ (redacted) | ✅ |
| Attach units to a PO, generate sales invoices | ❌ | ✅ |
| Edit payment fields on sales/repair jobs | ❌ | ✅ |
| Edit SKU master, manage vendors, manage dropdown-option lists | ❌ | ✅ |
| View Sales Ledger, Stock (Main ERP), RMA (vendor returns) | ❌ (page-gated) | ✅ |
| Flag a new accessory type / add a new customer (lightweight fields) | ✅ | ✅ |
| Activate a pending accessory, edit its cost | ❌ | ✅ |

## Important technical decisions already made
See `docs/decisions.md` for the full list with rationale. Headline ones:
- One shared `asset_ledger` for all unit provenance, not separate tables per entry door.
- Asset numbers are a PO-paperwork artifact, not an inventory-existence requirement — a unit is fully usable (QC'd, sold, returned) by `serial_number` alone before it's ever numbered.
- Paperwork completeness is always a **derived** boolean (`po_id IS NULL`, `sales.finalized`), never a separately-stored flag that could drift from reality.
- Employee-entered stock/sales are separated from historical/legacy data via `source` filtering, not a schema fork — "connecting" them later is removing a filter, not a data migration.
- `sold_by` is a free-text name from an owner-curated list, not a login-account FK, so staff without their own account can be credited.

## Current implementation status
See `docs/current-progress.md`.

## Known limitations / technical debt
- `sales.pmt` (legacy free-text payment note column) still exists but is unused by any current write path — superseded by `payment_status`/`payment_account`. Not removed (no harm leaving it).
- `invoices.invoice_number` has two redundant unique constraints (`invoices_invoice_number_key`, `invoices_invoice_number_unique`) — flagged in earlier planning (Part 4 of the historical plan) as a fix needed before bulk-backfilling old purchase invoices that might share one real invoice number across multiple migrated POs. **Not yet applied** — UNCERTAIN whether this is still needed depends on whether that bulk-backfill work happens.
- The 751 historically-migrated `purchase_orders` rows have no linked `invoices` (purchase-side) rows at all — by design, not a bug (see `docs/decisions.md`), but still an open backlog item for the owner.
- No automated test suite. All verification during development was manual (browser) + disposable live-HTTP scripts against a running dev server, cleaned up after each run.
- `docs/reconciliation_decisions.md` (pre-existing file, dated 2026-07-20) documents an earlier round of ADR-style decisions (trigger-based stock cache, RLS floor-raise, etc.) that were partially superseded/operationalized by the work described in `docs/decisions.md` — treat the newer file as authoritative where they overlap.

## Important assumptions
- This Supabase project is a **dev/staging copy**, not the live production database, per explicit user confirmation — schema changes here don't need a production-cutover safety margin, but the same migration steps should be re-verified against whatever project is actually production before that cutover happens.
- The owner is currently reconciling "current and old stock" (the historical/legacy/PO-migrated data) manually, outside the new employee-facing flow, on their own timeline — the new Live Stock/Sell/Service system and the old Stock/Sales data are expected to stay disconnected until the owner explicitly decides to "connect the strings."
