# Schema Reconciliation Decisions

> **Status:** Accepted  
> **Date:** 2026-07-20  
> **Decided by:** Shishir Chadha (Founder, DigitalBluez Technologies)  
> **Applies to:** db_erp (DigitalBluez internal ERP)  
> **Supersedes:** All prior implicit schema conventions

---

## Purpose

This document is the **single source of truth** for architectural decisions taken during the July 2026 schema reconciliation. Every schema duplication in db_erp has now been resolved. This file explains **what was decided, why, and what to do about it going forward**.

**When to read this doc:**
- Before adding any new table, column, or foreign key
- When touching SKU, purchase, invoice, or stock code
- When onboarding anyone new to the codebase
- When reviewing a PR that changes DB schema

**When to update this doc:**
- Only via a new ADR (Architectural Decision Record) appended at the bottom
- Never edit past decisions — they are historical record

---

## Executive summary

Eight decisions locked. Four are schema winners, four are cross-cutting fixes.

| # | Area | Winner (canonical) | Losers (deprecated) |
|---|------|--------------------|---------------------|
| 1 | SKU system | `sku_master` + `sku_category_templates` | `sku_base`, `sku_variants`, `sku_inventory` |
| 2 | Purchase order chain | `purchase_orders` → `purchase_order_items` → `purchase_order_asset_mapping` | `purchase_line_items`, `assets` (new-style), plus old `purchases` stays read-only historical |
| 3 | Invoice totals | `subtotal` + `total_gst` + `grand_total` | `total_amount`, `gst_total` |
| 4 | Stock counting | Hybrid: `stock_movements` = source of truth, `sku_master.quantity_in_stock` = trigger-maintained cache | `sku_variants.current_stock`, `sku_inventory.current_stock` |
| 5 | Row-level security | Proper policies per role (single-user now, RBAC-ready) | Blanket `auth.role() = 'authenticated'` |
| 6 | Soft-delete | `is_deleted` + `deleted_at` + `deleted_remarks` on all business tables | Hard-delete on new tables |
| 7 | Indexes | Explicit indexes on all high-traffic query paths | Reliance on default PK/unique indexes only |
| 8 | Repo hygiene | Clean structure, no zips at root, no misplaced scripts | Current mixed state |

---

## Deprecation strategy (applies to all "losers")

**We do not drop tables in this reconciliation.** Every losing table is renamed with a timestamped `_deprecated_` prefix (e.g. `sku_base` → `_deprecated_20260720_sku_base`), and its RLS is tightened to read-only. This preserves:

1. **Data safety** — nothing is lost. Rollback is a rename away.
2. **Audit trail** — old data can still be queried for historical reports.
3. **Migration window** — application code has 30+ days to be updated before final drop.

**Final drop schedule:** All `_deprecated_20260720_*` tables will be dropped in a follow-up migration on or after **2026-08-20**, once we confirm no production reads reference them.

---

## Decision records

Each decision below follows a lightweight ADR (Architectural Decision Record) format: **Context → Options → Decision → Rationale → Consequences → Migration Impact**.

---

### ADR-001: SKU system — `sku_master` wins

#### Context

Two parallel SKU modeling systems exist in the database:

- **System A:** `sku_master` (single table with `base_sku_code`, `variant_number`, `full_sku_code`, jsonb `specifications`) + `sku_category_templates` (per-category field schemas)
- **System B:** `sku_base` (product family) + `sku_variants` (variant with hardcoded `cpu`, `ram_gb`, `ssd_gb`, `screen_size` columns) + `sku_inventory` (separate stock counts)

Half the operational tables (`stock_movements`, `purchase_order_items`, `purchase_order_asset_mapping`, `invoice_items`, `reorder_rules`) reference System A. The other half (`assets`, `purchase_line_items`, `purchases`, `sku_inventory`) reference System B. This means stock counts on one side cannot align with sales/purchase records on the other.

#### Options considered

1. **Keep both** — impossible in practice; already causing referential ambiguity
2. **Winner: System A** — extensible, category-driven, GST-ready
3. **Winner: System B** — simpler two-table structure, better for pure laptops
4. **Design System C** — start fresh with a third model

#### Decision

**System A wins.** `sku_master` is the canonical SKU table. `sku_category_templates` defines per-category field schemas. System B tables (`sku_base`, `sku_variants`, `sku_inventory`) will be renamed to `_deprecated_20260720_*` and become read-only.

#### Rationale

1. **Matches stated design.** The founder's own CLAUDE.md specifies "SKU-{CATEGORY}-{BRAND}-{MODEL} + numeric variant suffix (001, 002...)". This maps 1:1 to `sku_master.base_sku_code` + `variant_number` → `full_sku_code`. System B's `sku_base` + `variant_code` does not match.
2. **Category-agnostic.** DigitalBluez sells LAP, DES, MON, TAB, RAM, SSD, KBD, MOUSE, CPU, GPU, and "OTHER". System B's hardcoded columns (`cpu`, `ram_gb`, `ssd_gb`, `screen_size`) only make sense for laptops/desktops. Selling a keyboard? Half the columns are null. Selling RAM? `ram_gb` becomes meaningless (RAM has speed, latency, ECC, not "gb of ram inside the RAM"). System A's jsonb `specifications` + template-per-category handles all categories cleanly.
3. **GST-ready.** `sku_master.hsn_code` is present. System B has no HSN column. HSN codes are legally required on Indian GST invoices — non-negotiable for the invoicing module.
4. **Lifecycle management.** `sku_master.status` supports active/discontinued/archived. System B has no equivalent, meaning discontinued SKUs would need to be deleted (losing history) or hacked via a naming convention.
5. **Reference weight.** More business-critical tables reference System A (5 tables including `stock_movements` and `invoice_items`) than System B. Migrating away from A would cost more than migrating away from B.
6. **Extension via jsonb + templates** is a proven ERP pattern (Odoo, ERPNext both use variants of this). Hardcoded columns are not.

#### Consequences

**Positive:**
- One SKU model — stock, sales, purchases all reconcile
- New categories can be added by inserting a row into `sku_category_templates`, no schema migration required
- GST and lifecycle handled natively
- Multi-tenant SaaS path (future income stream) stays open — jsonb specs are tenant-neutral

**Negative:**
- Tables currently pointing to `sku_variants` (`assets`, `purchase_line_items`, `purchases`) need migration. Handled by ADR-002 (which deprecates those tables anyway).
- Existing `sku_base` / `sku_variants` data must be migrated into `sku_master` if it has business value. To be handled by a one-time backfill script (out of scope for this reconciliation).

#### Migration impact

- Tables renamed: `sku_base` → `_deprecated_20260720_sku_base`, `sku_variants` → `_deprecated_20260720_sku_variants`, `sku_inventory` → `_deprecated_20260720_sku_inventory`
- Foreign keys **from deprecated tables** stay intact (they read the old data)
- Foreign keys **to deprecated tables** (from `assets`, `purchase_line_items`, `purchases`) will be dropped since those source tables are also being deprecated (see ADR-002)
- Application code must stop writing to deprecated tables (verified during migration script rollout)

---

### ADR-002: Purchase order chain — v1 wins

#### Context

Three parallel purchase data models exist:

- **Old flat:** `purchases` (one giant ~55-column table containing purchase + SKU + specs + sales lifecycle in a single row)
- **New v1:** `purchase_orders` → `purchase_order_items` → `purchase_order_asset_mapping`
- **New v2:** `purchase_orders` → `purchase_line_items` → `assets`

Both new chains share the same `purchase_orders` header table but branch on line items and asset tracking. This ambiguity means "what did we receive from PO #123?" has multiple potentially-inconsistent answers.

Note: The founder's CLAUDE.md already declares: *"Old `purchases` table stays intact as historical reference; new tables handle all new purchases."* That preserves `purchases` as read-only historical, but does not resolve v1 vs v2.

#### Options considered

1. **v1 wins** — richer asset lifecycle tracking, aligns with SKU System A
2. **v2 wins** — simpler, cleaner asset representation
3. **Merge v1 and v2** — combine the best of both into a new v3
4. **Keep both** — untenable

#### Decision

**v1 wins.** Canonical chain: `purchase_orders` → `purchase_order_items` → `purchase_order_asset_mapping`. Deprecate `purchase_line_items` and the new-style `assets` table. Keep old `purchases` as read-only historical.

#### Rationale

1. **Aligns with SKU System A.** `purchase_order_items.sku_id` and `purchase_order_asset_mapping.sku_id` both reference `sku_master`, which won ADR-001. `purchase_line_items.sku_variant_id` references the deprecated `sku_variants`.
2. **Explicit asset lifecycle.** `purchase_order_asset_mapping` tracks each individual asset through states: `reserved` → `received` → `in_stock` → `sold` → `faulty` → `returned`, with dedicated timestamps (`reserved_at`, `received_at`, `sold_at`). The `assets` table only has a single `status` column and a single `created_at`. For a refurbished IT business tracking individual laptops with unique asset numbers, explicit lifecycle is essential.
3. **Reservation semantics.** `purchase_order_items` supports `asset_prefix` + `asset_numbers_reserved` (array). This directly implements the founder's declared asset prefix rules: DBAS (DigitalBluez), TTAS{YY} (Techtenth), CSAS (Cash), custom (Other). Numbers are reserved when PO is submitted, then confirmed when received. The `assets` table has no such reservation concept.
4. **Serial number tracking.** Both `purchase_order_items.serial_numbers` (array) and `purchase_order_asset_mapping.serial_number` capture serials. Enables mapping serials to POs, which is required for warranty and refurb history.
5. **Matches stated PO workflow.** CLAUDE.md specifies states: Draft → Submitted → Partially Received → Received → Invoiced → Cancelled. "Partially Received" specifically requires per-line-item, per-asset receipt tracking — which v1 supports natively via the mapping table, and v2 does not.

#### Consequences

**Positive:**
- One clear source of truth for "what did we buy, when, from whom, and where is each unit today"
- Asset lifecycle is queryable end-to-end from PO to sale
- Supports partial receipt without hacks
- Ties cleanly into stock_movements (each receipt event → one stock_movement row)

**Negative:**
- Slightly heavier schema than v2 (three tables per PO)
- Application code currently writing to `purchase_line_items` / `assets` must be redirected. Handled during Purchase Module v2 completion (immediate next milestone).

#### Migration impact

- Tables renamed: `purchase_line_items` → `_deprecated_20260720_purchase_line_items`, `assets` → `_deprecated_20260720_assets`
- Old `purchases` table: **not renamed**. Kept as-is per founder's stated policy. Application code should treat it as read-only reference data.
- `sales.asset_number` currently FKs to old `purchases.asset_number`. This stays functional for historical sales. New sales will use the new chain via `invoice_items` (see ADR-003).

---

### ADR-003: Invoice totals — 3-column model wins

#### Context

The `invoices` table has two overlapping sets of total columns:

- **Set 1 (older):** `subtotal` + `total_gst` + `grand_total`
- **Set 2 (added later):** `total_amount` + `gst_total`

Both sets are populated by different code paths in the app. Which one is authoritative is currently unclear. Any report generator or PDF template has to guess. The two sets will inevitably drift over time.

#### Options considered

1. **3-column model wins** (`subtotal` / `total_gst` / `grand_total`)
2. **2-column model wins** (`total_amount` / `gst_total`)
3. **Remove all denormalized totals** — compute from `invoice_items` on read

#### Decision

**3-column model wins.** `invoices.subtotal`, `invoices.total_gst`, `invoices.grand_total` are the canonical fields. `invoices.total_amount` and `invoices.gst_total` are deprecated (marked with a comment; will be dropped in the follow-up migration on 2026-08-20 alongside the rest).

Totals are stored (not computed on read) because:
- Invoices are legal documents — the printed number must match the DB even if line items are later adjusted
- Read performance for reports (avoids joining `invoice_items` for every invoice list)

#### Rationale

1. **Semantic clarity.** "subtotal" and "grand_total" are unambiguous — one is pre-tax, one is post-tax. "total_amount" alone doesn't say which.
2. **Matches Indian GST invoice format.** Standard GST invoice layout prints subtotal (taxable value), GST breakup (CGST + SGST or IGST), then grand total (final payable). Three fields map 1:1.
3. **PDF generator needs three fields anyway.** `lib/generateInvoicePDF.ts` needs to render each of these separately. Storing them as one aggregated `total_amount` forces the PDF code to re-derive them, which is where bugs live.

#### Consequences

**Positive:**
- One authoritative total for each role — subtotal, tax, grand
- Reports and PDFs both read the same fields
- New invoices always use the 3-column model going forward

**Negative:**
- Existing invoices may have `total_amount` / `gst_total` populated but not `subtotal` / `grand_total`, or vice versa. Handled by a one-time backfill in the reconciliation SQL: for any row where 3-column fields are null but 2-column fields are populated, populate the 3-column fields from the 2-column values (grand_total := total_amount, total_gst := gst_total, subtotal := total_amount - gst_total).

#### Migration impact

- Add column comments to `total_amount` and `gst_total` marking them DEPRECATED
- Application writes to these two columns must stop
- One-time backfill SQL to populate 3-column fields where missing
- Columns dropped in follow-up migration on/after 2026-08-20

---

### ADR-004: Stock counting — hybrid (event-sourced with cached read)

#### Context

Three places currently claim to store "current stock":

1. `sku_master.quantity_in_stock` (column on the SKU itself)
2. `sku_variants.current_stock` (column on the variant, being deprecated per ADR-001)
3. `sku_inventory.current_stock` (separate table, being deprecated per ADR-001)

Additionally, `stock_movements` exists as an append-only ledger of every stock change (`quantity_change`, `quantity_before`, `quantity_after`).

Storing "current stock" in multiple places guarantees drift.

#### Options considered

1. **Pure cached (Option A)** — one denormalized column, updated in-place on every stock change. Fast, but drift risk if any code path forgets to update it.
2. **Pure event-sourced (Option C)** — no stored current stock; always compute `sum(stock_movements.quantity_change) where sku_id = X` on read. Always correct, but slow for dashboards showing 500 SKUs.
3. **Hybrid** — `stock_movements` is source of truth (immutable ledger). `sku_master.quantity_in_stock` is a cached read-optimized column, maintained by a Postgres trigger on `stock_movements` insert. Nightly reconciliation job verifies cache matches the ledger sum and alerts on drift.
4. **Materialized view** — Postgres materialized view over `stock_movements`, refreshed on cadence. Similar to hybrid but with refresh lag.

#### Decision

**Hybrid pattern wins.**

- `stock_movements` = **source of truth**. Append-only. Never updated or deleted. Every stock change (PO receipt, sale, adjustment, damage write-off) creates one row.
- `sku_master.quantity_in_stock` = **cached read**. Maintained by a Postgres AFTER INSERT trigger on `stock_movements` that updates the SKU's cached count. Application code reads this column for dashboards.
- **Reconciliation function** — a Postgres function `reconcile_stock_cache()` compares the cached column against `sum(quantity_change)` from movements. Runs nightly via Supabase pg_cron (or manually as needed). Logs any drift; a follow-up alerting mechanism (Phase 3) will notify on drift.

#### Rationale

1. **Correctness first.** An ERP that lies about stock loses customer trust and money. Event-sourced ledger guarantees we can always reconstruct the truth.
2. **Performance second.** Dashboards showing 100+ SKUs cannot afford to sum thousands of movement rows per SKU on every page load. Cached column is O(1) read.
3. **Auditability.** Every stock change has a row in `stock_movements` with `movement_type`, `po_id`, `invoice_id`, `notes`, `created_by`. Full audit trail for GST audits, damage claims, disputes.
4. **Self-healing.** Nightly reconciliation catches drift automatically. If a bug ever bypasses the trigger, next reconciliation surfaces it.
5. **Standard industry pattern.** Used by every serious ERP (SAP, Odoo, ERPNext).

#### Consequences

**Positive:**
- Correctness + speed
- Full history is queryable for stock movement reports (in/out per period, per SKU, per vendor)
- Reconciliation makes bugs visible rather than silent

**Negative:**
- Every application code path that changes stock **must** insert into `stock_movements`, not update `quantity_in_stock` directly. Enforced via revoked direct-update permissions on `quantity_in_stock` (only the trigger can update it).
- Trigger complexity — but written once, tested once, and boring afterwards.

#### Migration impact

- Add Postgres trigger `trg_stock_movements_update_cache` on `stock_movements` AFTER INSERT
- Add Postgres function `reconcile_stock_cache()` for nightly verification
- Add Supabase pg_cron job to call reconciliation function nightly (or document manual execution if pg_cron not available on the current plan — Supabase Free tier may require this)
- One-time initial reconciliation to populate `sku_master.quantity_in_stock` from existing `stock_movements` (if any) or zero out

---

### ADR-005: Row-level security — proper policies now

#### Context

Current RLS on almost every business table:

```sql
CREATE POLICY "..." ON <table> FOR ALL USING (auth.role() = 'authenticated');
```

Meaning: any user who is logged in has full read/write/delete access to every table. Three tables (`purchase_orders`, `purchase_order_items`, `purchase_order_asset_mapping`) go further with `USING (true)` — literally no restriction at all beyond RLS being enabled.

Only `activities` has proper user-scoped policies (`auth.uid() = user_id`).

For a single-user system today, this is functionally fine. But it:
- Blocks Phase 5 (RBAC — role-based access control) without a full rewrite
- Prevents any future multi-tenant SaaS path
- Fails a basic security audit

#### Options considered

1. **Leave as-is until multi-user is needed** — deferred risk, but writes the code with the wrong assumptions
2. **Full RBAC now** — over-engineering for a single-user app; slow to build
3. **Structured single-user RLS with RBAC hooks** — proper policies now, wired to `auth.uid()` and a `user_role` claim, but with a default "admin" role that behaves like today

#### Decision

**Option 3.** Implement structured RLS with:

- All business tables restricted to authenticated users **at minimum** (unchanged floor)
- Writes require authenticated user
- Ownership columns (`created_by`, `updated_by`) enforced via WITH CHECK
- A `users.role` column (values: `admin` | `staff` | `viewer`) prepared but defaulting all existing users to `admin` (so behavior is unchanged today)
- Policies written in a way that future roles can be added by adjusting one SECURITY DEFINER function, not by rewriting every policy

#### Rationale

1. **Future-proof without over-building.** Today's behavior is preserved (single admin = full access). Tomorrow's roles slot in without a rewrite.
2. **Blocks accidental privilege escalation.** `USING (true)` means a service_role key leak or misconfigured client could delete everything silently. Proper policies constrain damage.
3. **Compliance readiness.** GST audits and any future ISO/SOC 2 posture require documented access controls.
4. **SaaS pathway.** If db_erp ever becomes multi-tenant, tenant isolation piggybacks on the same policy structure (add `tenant_id`, filter on it).

#### Consequences

**Positive:**
- Security posture materially improved with near-zero behavior change today
- RBAC (Phase 5) becomes an incremental change, not a rewrite
- Multi-tenant SaaS path stays open

**Negative:**
- One-time complexity in writing the policies right (mitigated by handling it now, once)
- Every future new table needs a proper policy (documented as a rule in AGENTS.md going forward)

#### Migration impact

- Drop all existing permissive policies
- Add `users.role` column (default `'admin'`)
- Create `SECURITY DEFINER` helper function `is_admin(uid)`, `has_role(uid, role)`
- Add policies per table: SELECT for authenticated, INSERT/UPDATE/DELETE for admin (which today = everyone)
- `activities` retains user-scoped policies (already correct)

---

### ADR-006: Soft-delete standardization

#### Context

Old business tables (`purchases`, `sales`, `customers`, `vendors`, `expenses`, `invoices`, `accessories`) have soft-delete columns: `is_deleted boolean`, `deleted_at timestamptz`, `deleted_remarks text`.

New tables (`assets`, `purchase_line_items`, `purchase_order_items`, `purchase_order_asset_mapping`, `sku_master`, `sku_variants`, `sku_base`, `sku_inventory`, `stock_movements`) mostly do not.

Result: consistency in the application layer is impossible. "Show me all POs including deleted ones" works for some tables and not others.

#### Options considered

1. **No soft-delete anywhere** — clean but destructive; a wrong click means lost data
2. **Soft-delete only on critical tables** — inconsistent, developer must remember which is which
3. **Soft-delete on all business tables** — consistent, mildly redundant on truly immutable tables

#### Decision

**Option 3, with one exception.**

Add `is_deleted boolean DEFAULT false`, `deleted_at timestamptz`, `deleted_remarks text` to all business tables that don't have them:
- `purchase_orders` (currently has only `is_deleted`, add the other two)
- `purchase_order_items`
- `purchase_order_asset_mapping`
- `sku_master`
- `stock_movements` — **exception:** stock_movements is an immutable append-only ledger. Deletions must never happen. Do not add soft-delete columns. Instead, add a **reversing entry** convention: to "undo" a stock movement, insert a compensating row with opposite `quantity_change` and `notes` explaining why. This preserves the audit trail.

Deprecated tables do not need soft-delete added (they are frozen anyway).

#### Rationale

1. **User safety.** Deletions in an ERP are almost always wrong — the correct action is usually "mark as void" or "cancel", not physical delete. Soft-delete makes that recoverable.
2. **Legal.** GST regulations in India require retention of invoices and financial records for at least 6 years. Physical deletion of an invoice creates compliance risk.
3. **Consistency.** Application code can use one uniform `WHERE is_deleted = false` filter everywhere.
4. **stock_movements exception.** An immutable ledger derives its correctness from being immutable. Deleting a movement (even softly) invalidates the running balance derivation. Compensating entries are the standard bookkeeping pattern.

#### Consequences

**Positive:**
- Uniform delete semantics across all business tables
- One clear rule for stock movements (never delete; reverse instead)
- Application code simplified

**Negative:**
- Every SELECT must include `WHERE is_deleted = false` (or use a view — considered but rejected as adding complexity for minor gain; documented rule instead)

#### Migration impact

- Add columns to tables listed above
- Existing rows: `is_deleted = false`
- No triggers needed — soft-delete is application-driven

---

### ADR-007: Explicit indexes on high-traffic paths

#### Context

Beyond primary key and unique constraint indexes, the schema has essentially no indexes. For an ERP that will run reports over months of data, this is a performance timebomb — every stock movement report, every sales register, every dashboard becomes a sequential scan.

#### Options considered

1. **Wait for slowness, add indexes reactively** — reactive is fine for prototypes; not for ERP
2. **Add all reasonable indexes now** — small storage cost, large query speedup
3. **Only add on tables with observed slowness** — hybrid

#### Decision

**Option 2.** Add explicit indexes now for the query patterns we know will be common in reports and dashboards.

Indexes to add (all on canonical / non-deprecated tables):

| Table | Index | Purpose |
|-------|-------|---------|
| `stock_movements` | `(sku_id, created_at DESC)` | Stock ledger per SKU, most recent first |
| `stock_movements` | `(created_at DESC)` | All-movements chronological dashboard |
| `stock_movements` | `(po_id)` | "What did this PO produce in stock?" |
| `stock_movements` | `(invoice_id)` | "What did this invoice consume?" |
| `purchase_orders` | `(po_status, po_date DESC)` | PO list filtered by status |
| `purchase_orders` | `(vendor_id, po_date DESC)` | Vendor purchase history |
| `purchase_order_items` | `(po_id)` | Load items for a PO |
| `purchase_order_asset_mapping` | `(status, asset_number)` | Asset lookup by status |
| `purchase_order_asset_mapping` | `(po_item_id)` | Line-item to assets |
| `invoices` | `(customer_id, invoice_date DESC)` | Customer invoice history |
| `invoices` | `(invoice_date DESC, status)` | Invoice register |
| `invoices` | `(payment_status)` | Outstanding invoices dashboard |
| `invoice_items` | `(invoice_id)` | Load items for an invoice |
| `invoice_items` | `(sku_id)` | Sales history per SKU |
| `sales` | `(sale_date DESC)` | Legacy sales register |
| `sales` | `(customer_name)` | Customer lookups on legacy |
| `sku_master` | `(category, brand)` | SKU catalog browsing |
| `sku_master` | `(status)` | Active SKUs filter |
| `activities` | `(user_id, status, due_date)` | Activity hub main query |
| `vendors` | `(is_deleted)` partial index | Active vendors filter |
| `customers` | `(is_deleted)` partial index | Active customers filter |

Partial indexes (`WHERE is_deleted = false`) chosen where applicable to keep index size small.

#### Rationale

1. **Cheap now, expensive later.** Adding indexes to empty or small tables is milliseconds. Adding indexes to a 10M-row table is hours of downtime.
2. **Query patterns are known.** These indexes reflect ERP report and dashboard access patterns, not speculation.
3. **Cost is trivial.** Storage overhead: negligible at current scale. Write overhead: microseconds per insert.

#### Consequences

**Positive:** Reports, dashboards, and searches remain fast as data grows.  
**Negative:** Slight write amplification (acceptable).

#### Migration impact

Indexes created with `CREATE INDEX IF NOT EXISTS` — safe to re-run. Uses `CREATE INDEX CONCURRENTLY` where possible to avoid locking tables (Supabase supports this on paid plans; on Free plan, standard CREATE INDEX is fine given current data volume).

---

### ADR-008: Repository hygiene

#### Context

Working tree contains artifacts that should not be in version control or are in the wrong location:

1. `app.zip`, `components.zip`, `lib.zip` — backup archives at repo root
2. `app/csv_to_sql.py` — Python script inside Next.js `app/` directory (which is meant for App Router pages only)
3. `db_erp.git/next-monorepo/` — a monorepo scaffold nested inside `.git/`, likely accidental
4. `package.json` issues:
   - `apify-client` dependency — web scraping library, unclear purpose in an ERP
   - `shadcn` listed as runtime dependency — it's a CLI tool, should be devDependency
   - Both `radix-ui` umbrella and individual `@radix-ui/react-dialog`, `@radix-ui/react-select` — redundant, the umbrella already includes these

#### Options considered

Only one: fix all of the above. No trade-offs.

#### Decision

Fix all four groups of issues in a single scripted cleanup (`scripts/repo_cleanup.sh` + `package.json` diff), executed manually with review.

Specifically:
- Move `*.zip` to `docs/backups/` (or delete if backed up elsewhere) and add `*.zip` to `.gitignore`
- Move `app/csv_to_sql.py` to `scripts/csv_to_sql.py`
- Investigate `db_erp.git/next-monorepo/` — appears to be an unrelated repo committed inside `.git/`; delete after confirming
- Remove `apify-client` from dependencies (confirm no imports first)
- Move `shadcn` to `devDependencies`
- Remove `@radix-ui/react-dialog` and `@radix-ui/react-select` (umbrella already covers these)

#### Rationale

Repo cleanliness compounds. Every future contributor (including future-you) is faster in a clean repo.

#### Consequences

**Positive:** Faster onboarding, faster CI, smaller repo, no confusion over "which is the real script."  
**Negative:** None.

#### Migration impact

Non-schema, executed via shell script + a package.json edit. No DB impact.

---

## Timeline

| Date | Action |
|------|--------|
| 2026-07-20 | Decisions accepted (this document) |
| 2026-07-20 | Migration scripts 01–03 applied to production Supabase |
| 2026-07-20 | Repo cleanup script executed |
| 2026-07-20 → 2026-08-20 | Application code updated to stop writing to any `_deprecated_20260720_*` table. All modules verified to use only canonical tables. |
| 2026-08-20+ | Follow-up migration: physically drop `_deprecated_20260720_*` tables |

## How to reference this doc

- In code comments: `// See docs/reconciliation_decisions.md ADR-001`
- In commit messages: `refactor(sku): migrate stock queries to sku_master (ADR-001, ADR-004)`
- In PR descriptions: link to the ADR being implemented or affected
- In new ADRs: reference the ADR number(s) being superseded or extended

## Adding new ADRs

Future architectural decisions should be appended to this document as **ADR-009**, **ADR-010**, etc., following the same format: Context → Options → Decision → Rationale → Consequences → Migration Impact.

Do not edit past ADRs. If a decision is reversed, write a new ADR that supersedes it and reference the original.
