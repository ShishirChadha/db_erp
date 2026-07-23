@AGENTS.md

# Project Instructions

## What this is
ERP for a refurbished-laptop/desktop reseller (Digitalbluez / Techtenth — two buying/payment entities under one business, not separate vendors). Covers purchasing, SKU/inventory, sales, accessories, and repair/replacement/return tracking. Supabase project is currently a **dev/staging copy**, not production — but treat schema changes with the same care as prod (always back up first; see below).

## Stack
- Next.js 16.2.1 (App Router, Turbopack), React 19.2, TypeScript
- Supabase (Postgres + Auth), accessed via `lib/supabase/{client,server,service}.ts`
- Tailwind CSS v4, shadcn/radix-ui components
- No test framework configured — verification is via live HTTP scripts against a running `npm run dev` (see Testing below)

## Architecture
- API routes (`app/api/**/route.ts`) do all writes via `supabaseAdmin` (service-role client) — RLS is not the enforcement boundary for most tables; the API layer is.
- Auth/role resolution: `lib/auth/session.ts` (`getSessionUser()` from Bearer token for API routes, `getCookieSessionUser()` for server components), `isOwner()` type-guard.
- Two roles: `owner` and `employee`, stored in `profiles` table. Role check happens in the route handler, not middleware — there is no `middleware.ts`.
- Sensitive-field redaction: `lib/auth/redact.ts` strips cost/vendor/margin fields from API responses for `employee` role. New employee-facing routes should not `.select()` those columns at all rather than fetch-then-redact.
- Page-level gating (`components/RequireOwner.tsx`) is UX-only, not a security boundary — every route it wraps must also check role server-side.
- Generic owner-curated dropdown lists (CPU, RAM, storage, staff names, etc.) live in one `custom_options` table, managed via Settings → Dropdown Options (`components/DropdownOptionsManager.tsx`), read via `lib/useCustomOptions.ts` + `components/SearchableSelect.tsx`. Add new dropdown types by using this pattern, not a new table.

## Data model (see `docs/project-context.md` for full detail)
- **`sku_master` is the single universal catalog for every sellable physical item in the business** — laptops, desktops, monitors, tablets, and every accessory (RAM, SSD, CPU, GPU, keyboard, mouse, and anything else, via the generic `ACC` category). There is no separate catalog/quantity table for any category of item. `sku_category_templates` defines the spec schema per category; adding support for a new *kind* of item means adding a category row there, never a new table. `stock_movements` (trigger-synced into `sku_master.quantity_in_stock`) is the universal quantity ledger for all of them. `asset_ledger` sits on top of `sku_master` only for items that need **per-unit** tracking (serial number, QC, warranty, individual sale) — laptops/desktops/monitors/tablets need this; fungible accessories (a mouse, a stick of RAM) do not and are tracked by quantity alone, the same way `stock_movements` already supports with zero dependency on `asset_ledger`. Before adding any new item type or a new inventory/quantity mechanism, check whether it's just a new `sku_category_templates` category first — this exact drift (a second, undocumented `accessories`/`accessory_movements` table pair growing up alongside `sku_master`) is why this rule is now written down; see `docs/decisions.md` for the consolidation that fixed it.
- `asset_ledger` is the per-unit inventory table (one row per physical laptop/desktop/monitor/tablet) for categories that need per-unit tracking. It has `source` ∈ `('purchase_order','legacy_purchase','employee_intake')` — **never mix these in a query without an explicit reason**; the employee-facing "Live Stock" system and the owner's "main ERP" Stock page are deliberately kept non-overlapping by filtering on `source`.
- `asset_number` is only assigned when a real Purchase Order exists for a unit (via `reserve_assets()` RPC, called from `/api/purchase-orders/from-intake` or the PO wizard). Units can be QC'd, sold, and returned entirely by `serial_number` before they ever get a PO/asset number. Do not add an asset-number requirement anywhere in the operational (QC/sell/service) flow. Fungible/quantity-only SKUs (most accessories) never get asset numbers at all — a purchase for them is a single `purchase_order_items` row with `quantity = N` (no `reserve_assets`, no per-unit `asset_ledger` rows), whether it enters via the normal PO wizard (category-aware `submit`/`receive`, see `lib/sku-categories.ts`) or the deferred `from-accessory-stock` attach. The serialized-vs-fungible branch — not a separate accessory codepath — is what keeps PO/receive/Purchase-Invoice a single flow for every sellable item.
- `sku_master.quantity_in_stock` is a trigger-maintained cache (`trg_sync_sku_stock`) driven off `stock_movements` inserts — never update `quantity_in_stock` directly from application code. This trigger only reads `stock_movements.sku_id`/`quantity_change`; it has no dependency on `asset_ledger`, which is exactly what makes quantity-only (no per-unit row) tracking of accessories work correctly today.
- `sales.sold_by` is a **plain text name** (not a login-account FK) drawn from `custom_options` category `staff_names`, so staff without their own account can still be credited.
- Money fields (`cost_price`, `vendor_id`, `unit_price`, GST cost breakdowns) are redacted from `employee`-role API responses. Selling price is NOT redacted — employees can see and set it.

## Business rules that must not be violated
- An employee's stock-in/stock-out entry is **immediately real** (inventory moves at entry time) — there is no owner-approval gate on operational data. The owner's job is deferred bookkeeping (attach a PO, generate an invoice), tracked by **derived flags** (`po_id IS NULL`, `sales.finalized`), never a separate status column that can drift out of sync.
- Employees must never see purchase cost, vendor identity, or margin anywhere in the UI or API response.
- Only the owner role can: attach units to a PO, generate invoices, edit payment fields (`payment_status`, `amount_paid`, `payment_account`) on sales/repair jobs, edit SKU master data, manage vendors, manage dropdown-option lists.
- Numbering (asset numbers, PO numbers, invoice numbers, repair job numbers) must go through the existing atomic RPCs (`reserve_assets`, `generate_po_number`, `increment_invoice_number`, `generate_repair_job_number`) — never a client-side MAX-scan or manual counter increment.

## Coding conventions
- Reuse existing lib helpers before writing new logic: `lib/sku-resolver.ts` (`resolveOrCreateSku`), `lib/purchase-utils.ts` (`recalcPOTotals`, `getVendorName`), `lib/accessory-movements.ts`, `lib/sales-entry.ts`.
- Prefer extending a shared component over forking a near-duplicate page (e.g. `components/StockView.tsx` is parameterized and mounted at two routes rather than copy-pasted).
- No test framework — verify behavior with a disposable Node script that signs in real Supabase auth users (owner + employee), hits the running dev server's real HTTP endpoints, and **always cleans up every row/user it created before finishing** (verify this actually happened — don't trust a script's own "cleaned up" print statement without re-querying).
- Don't run `rm -rf .next` while `npm run dev` is running — it corrupts the running dev server; stop it first if you need a clean build.

## Before modifying code
- Check for an existing table/column/RPC/helper before adding a new one — this schema has accumulated some duplicate/dead mechanisms in the past (see `docs/decisions.md` for what was already cleaned up and why).
- Check `docs/current-progress.md` for what's already built vs. in progress before starting new work in the Stock/Sales/Repair/Accessories area.

## Autonomous development rules
- Always back up before a schema migration: `supabase db dump --linked -f backups/<date>_<label>_schema_backup.sql` (schema) and `--data-only` (data).
- Apply migrations via the Supabase MCP tools, not raw psql.
- Run `mcp__supabase__get_advisors` after schema changes.
- Type-check (`npx tsc --noEmit -p .`) and run a production build (`npm run build`, with the dev server stopped) before considering a feature done.
- Don't ask "should I proceed?" once a plan is approved — proceed and only pause for destructive/irreversible actions or a decision only the user can make.
