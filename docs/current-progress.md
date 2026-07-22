# Current Progress

Last updated: 2026-07-22 (end of a session that: committed the previously-uncommitted
employee-facing operational system; ran a dead-table audit; cleaned up leaked test
data; fixed a batch of real bugs the owner found while entering live purchase data
(PO wizard totals, asset numbering, SKU dropdowns/variants, Fix SKU); and added
support for selling a physically-upgraded unit with cost tracking).

## Completed

**Security foundation**
- `profiles` table + 2-tier role system (owner/employee), `lib/auth/session.ts`, `lib/auth/redact.ts`.
- Every previously-unauthenticated route (`purchase-orders`, `sku-master`, `stock`, etc.) now requires a session and redacts cost/vendor/margin for `employee` role.
- `SearchableItemSelect.tsx` (invoice item picker) rewired off a direct client-side cost-leaking query onto the redacted `/api/stock` route.

**Stock Intake, Sell, Service (the core employee-facing system)**
- `/dashboard/entry` launcher → Stock Intake, Sell, Service.
- Stock Intake: creates a live `asset_ledger` row immediately (`status='qc_pending'`, real `stock_movements` receipt), `asset_number` stays `NULL` until a PO is attached.
- Sell: unit or standalone-accessory sale, final immediately (stock/accessory quantity moves at entry time), supports bundled free accessories, payment tracking (paid/partial/pending + amount + which account received it), staff attribution (`sold_by`), inline new-customer creation.
- Service: repair / replacement / return in one screen with a sub-type selector. Replacement swaps a unit in immediately (marked `sold` at job creation, matching the "live" principle — not gated behind owner approval). Return reuses the pre-existing `asset_rma_events`/`POST /api/rma` (`direction='from_customer'`).
- Both Sell and Service support browsing from a list (Live Stock page, Accessories page) via `?asset_id=`/`?accessory_id=`/`?subtype=` query-param prefill, in addition to their own inline search.

**QC (itemized, not a single field — corrects earlier planning docs)**
- `asset_qc_checks` table exists and is live: one row per checklist item per QC run (`check_item`, `result` pass/fail/na, `notes`, `checked_by`, `checked_at`), written via `PUT /api/asset-ledger/[id]/qc`. `asset_ledger.qc_grade`/`qc_status` remain the summary fields driven off the checklist. `/dashboard/stock/[id]/page.tsx` is the QC-run UI (both roles).

**Purchasing paperwork (owner side)**
- `POST /api/purchase-orders/from-intake`: owner selects any number of `employee_intake` units (in any status, including already-sold), groups them by SKU, and adopts them into a real PO — this is the only place these units are ever assigned an asset number. Existing `POST /api/purchase-invoices` flow is unchanged and used as-is afterward.
- `POST /api/sales/[id]/finalize` is invoice-only bookkeeping (mints the GST invoice, does not touch inventory — that already happened at sale time). Note: it re-reads the asset's *current* SKU live at finalize time, not whatever was true at sale time — this is what makes reassigning a unit's SKU between sale and finalize correctly show up on the invoice (see "Fix SKU" below).

**Stock views**
- `/dashboard/live-stock` (both roles): Current/Sold tabs, `source='employee_intake'` only.
- `/dashboard/stock` (owner-only): same component, `source != 'employee_intake'` — the owner's historical/legacy reconciliation workspace, deliberately isolated from the live system.
- Owner-only affordances on both: PO/Invoice status flags, bulk "Create PO from Selected," "Generate Invoice," "Fix SKU" deep-link, a missing-PO/missing-invoice count banner, and a "Delete" action for orphan (no-PO, unsold) rows.

**Accessories, Repair Jobs, Sales Ledger (list pages)**
- `/dashboard/accessories`: catalog + pending-review activation (owner) + Sell shortcut per row.
- `/dashboard/repair-jobs`: list + inline payment-field edit and Mark Done (owner).
- `/dashboard/sales` (Sales Ledger, owner-only): every sale, inline edit of customer/price/payment fields, Generate Invoice — replaced the old free-text `AddSaleDialog`/`EditSaleDialog` (deleted, fully superseded).

**Supporting infrastructure**
- `custom_options` generic dropdown-list table + `DropdownOptionsManager.tsx` (Settings) — powers CPU/RAM/Generation/Storage/Screen-Size dropdowns across Stock Intake, `AddPurchaseDialog`, and `SkuFormModal` (New SKU / Edit SKU), plus the `staff_names` list for Sold By.
- `QuickAddCustomerDialog.tsx` — lightweight customer-add (name/type/phone/email/address) for Sell/Service; now also shows Has GST / GST Number when type=Business, matching the full CRM form's fields.
- Removed the standalone "Owner Review" queue page entirely — its job is now split across the Stock pages' inline flags and the Accessories/Repair Jobs list pages.

**Bug-fix + feature pass on live purchasing/SKU workflow (this session, from owner-reported issues)**
- **PO wizard Step 2 totals bug**: increasing quantity after editing "Line Total" used to silently shrink unit price (stale reverse-calc). Fixed by making quantity/unit-price/GST% edits always forward-recompute the total; only a direct edit of Line Total itself reverse-solves unit price. `app/dashboard/purchase-orders/new/page.tsx`.
- **Asset numbering**:
  - Counter-reconciliation tools (`app/api/settings/asset-counters/route.ts`, and previously a step in PO hard-delete) used a lexicographic string sort to find "the max asset number," which could pick an old-format number (`DBAS682`) over a higher new-format one (`DBAS26-699`). Now numeric/format-aware, filtered to the target prefix+year only.
  - PO hard-delete no longer tries to "recover" reserved numbers on delete — it was the source of the lexicographic bug and fighting the project's own atomic-never-reused numbering design; removed entirely rather than patched.
  - **Legacy renumbering**: all 697 old-format asset numbers (`DBAS0001`–`DBAS682`, `C0001`–`C0024`, `SHIS1`, plus 2 malformed ones) renamed to the current `PREFIX<YY>-<seq>` format, using each unit's real historical purchase year (from its linked PO's `po_date`, not the bulk-migration timestamp). Original numbers preserved in a new `asset_ledger.legacy_asset_number` column for audit/physical-tag cross-reference. `asset_counters` corrected per (prefix, year). Verified zero collisions, zero old-format rows remaining.
  - Deferred (not done): making PO submission fully atomic (single Postgres RPC) so a mid-submit failure can never again let the counter drift ahead of the ledger — see Known issues.
- **SKU spec entry**: CPU/RAM/Generation/SSD/Screen-Size now use `custom_options` dropdowns in `AddPurchaseDialog.tsx` and `SkuFormModal` (previously free-typed number inputs with a regex-normalization rule that silently collapsed combined values like "8GB+8GB" down to "8"). `SkuFormModal` was extracted from `sku-master/page.tsx` into standalone `components/SkuFormModal.tsx` so it could be reused elsewhere (PO wizard, Fix SKU dialog).
- **Combined RAM/SSD support**: RAM/SSD fields switched from number+regex to plain dropdown strings; existing catalog data migrated from bare numbers to canonical strings (`8` → `"8GB"`); combined configs (e.g. "8GB + 8GB (16GB)") added as their own atomic `custom_options` entries rather than something the code tries to parse.
- **Fix SKU**: previously just a deep-link to a search page with no way to actually reassign anything, and editing a SKU's specs in place had no duplicate-safety check (could silently create a second SKU with identical specs). Now a real picker (`components/FixSkuDialog.tsx` + `PATCH /api/asset-ledger/[id]/reassign-sku`) that reassigns an asset (or its whole PO line item, if shared) to an existing or newly-created SKU; `PUT /api/sku-master/[id]` now rejects an edit that would duplicate another existing SKU's specs, pointing at the "Fix SKU" action instead.
  - `reassign-sku` is intentionally open to **both roles**, not owner-only — it never touches cost/vendor data, unlike editing SKU master specs (which remains owner-only).
  - Bug fixed in the same pass: reassignment previously never adjusted `sku_master.quantity_in_stock` on either the old or new SKU (no compensating `stock_movements` row was ever written) — now it inserts the -1/+1 pair, same trigger-driven pattern as every other stock-affecting action.
- **PO wizard inline SKU creation**: Step 2's SKU search now offers "+ Create new SKU" when nothing matches, using the shared `SkuFormModal`, with no page reload.
- **Stock/Sell search**: `GET /api/stock`'s `search` param only matched `asset_number`/`serial_number` — typing a brand/model (e.g. "Lenovo", "T450") returned nothing. Now also resolves matching SKUs by code/brand/model/description and includes their units.
- **Selling a physically-upgraded unit**: the Sell form (`app/dashboard/entry/sell/page.tsx`) now has a "Wrong or upgraded spec? Change SKU" link once a unit is selected, open to both roles, using the same Fix-SKU picker (with its own "+ Create new SKU" escape hatch for a spec that's never existed before). If the owner is the one doing it, an optional "Additional cost for this upgrade" field is also shown (never shown to employees) — recorded via a new `asset_cost_adjustments` table (append-only ledger, same idiom as `stock_movements`/`asset_qc_checks`) and a new owner-only `GET`/`POST /api/asset-ledger/[id]/cost-adjustments` route. The asset detail page (`/dashboard/stock/[id]`) has a matching owner-only "Cost Adjustments" panel (original cost, running total, add-anytime form) — not only reachable from the sale moment, matching the project's "owner's paperwork is deferred" pattern.

## Currently being worked on
Nothing mid-flight. All changes from the bug-fix/upgrade-tracking pass have been committed (commit `957e3a3`), type-checked, and production-build-verified. Dead-table cleanup migration has been applied successfully.

## Remaining / not yet started
- **Issue E's deeper structural fix** (deferred, flagged during the asset-numbering pass): make PO submission fully atomic via one Postgres RPC (reserve + insert + update, all in one transaction) so the counter can never again drift ahead of the ledger from a mid-submit failure. The `manualOverride` free-text asset-number path in the legacy `purchases` routes also still bypasses the numbering system entirely — a known risk, not yet addressed.
- **Part 4 (bulk historical purchase import + invoice-number constraint fix)**: not started. Requires the user to supply bank statements + WhatsApp invoice images before any import script can be built.
- Warranty tracking: schema exists (`asset_ledger.warranty_type`, `warranty_start_date`, `warranty_duration_months`, `warranty_expiry_date`) but no UI/workflow reads or writes them yet.
- No margin/profit reporting exists anywhere yet (`app/dashboard/reports` doesn't reference cost data) — the new `asset_cost_adjustments` table is a foundation for this but nothing currently consumes it for reporting.

## Known issues
- `sales.pmt` legacy column is dead but not dropped (harmless).
- `invoices.invoice_number` has two redundant unique constraints — not yet fixed (blocks any future bulk-backfill of purchase invoices where one real invoice covers multiple migrated POs).
- Atomic PO-submit RPC and the legacy `manualOverride` numbering bypass are known, accepted risks (see "Remaining" above).

## Exact next recommended steps
1. Verify asset numbering is correct (user raised a concern about DBAS26-699–705 being generated; prior DB had DBAS682; legacy renumbering should have converted it to DBAS26-111).
2. Decide whether the atomic PO-submit RPC (Issue E's deferred structural fix) is worth scheduling, especially if numbering drift recurs.
3. The highest-value remaining gap is the bulk historical purchase import (Part 4), pending the user's bank/invoice records.

## Pending decisions
- Whether/when to "connect the strings" between Live Stock (employee_intake) and the main ERP Stock (legacy/PO) — explicitly deferred by the user until their manual reconciliation of old data is done.
- Whether the invoice-number unique-constraint fix (Part 4) is still needed depends on whether the bulk historical-purchase-import work happens at all.
- Whether/when to schedule the atomic PO-submit RPC (deferred structural fix for asset-number drift).
