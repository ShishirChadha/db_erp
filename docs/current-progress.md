# Current Progress

Last updated: 2026-07-22 (end of the session that built the employee-facing operational system, Parts 5–8 of the historical plan).

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

**Purchasing paperwork (owner side)**
- `POST /api/purchase-orders/from-intake`: owner selects any number of `employee_intake` units (in any status, including already-sold), groups them by SKU, and adopts them into a real PO — this is the only place these units are ever assigned an asset number. Existing `POST /api/purchase-invoices` flow is unchanged and used as-is afterward.
- `POST /api/sales/[id]/finalize` is invoice-only bookkeeping (mints the GST invoice, does not touch inventory — that already happened at sale time).

**Stock views**
- `/dashboard/live-stock` (both roles): Current/Sold tabs, `source='employee_intake'` only.
- `/dashboard/stock` (owner-only): same component, `source != 'employee_intake'` — the owner's historical/legacy reconciliation workspace, deliberately isolated from the live system.
- Owner-only affordances on both: PO/Invoice status flags, bulk "Create PO from Selected," "Generate Invoice," "Fix SKU" deep-link, a missing-PO/missing-invoice count banner.

**Accessories, Repair Jobs, Sales Ledger (list pages)**
- `/dashboard/accessories`: catalog + pending-review activation (owner) + Sell shortcut per row.
- `/dashboard/repair-jobs`: list + inline payment-field edit and Mark Done (owner).
- `/dashboard/sales` (Sales Ledger, owner-only): every sale, inline edit of customer/price/payment fields, Generate Invoice — replaced the old free-text `AddSaleDialog`/`EditSaleDialog` (deleted, fully superseded).

**Supporting infrastructure**
- `custom_options` generic dropdown-list table + `DropdownOptionsManager.tsx` (Settings) — powers CPU/RAM/storage/screen-size dropdowns in Stock Intake and the `staff_names` list for Sold By.
- `QuickAddCustomerDialog.tsx` — lightweight customer-add (name/type/phone/email/address only) for Sell/Service, separate from the full CRM `AddCustomerDialog.tsx` used on the Customers page.
- Removed the standalone "Owner Review" queue page entirely — its job is now split across the Stock pages' inline flags and the Accessories/Repair Jobs list pages.

## Currently being worked on
Nothing mid-flight — the last unit of work (Sell/Service unit-browsing, payment tracking, staff attribution, Live Stock separation) was completed, live-tested, and production-build-verified in this session. This documentation pass is the current task.

## Remaining / not yet started
From the original multi-part plan, **not yet done**:
- **Part 1–2 audit items not yet executed**: consolidating asset-numbering onto a single mechanism app-wide (mostly done via `reserve_assets`, but worth re-auditing for stragglers), dropping the dead tables (`assets`, `sku_inventory`, `sku_base`, `sku_variants`, `purchase_line_items`) and their vestigial triggers, standardizing on one file-upload mechanism, fixing the `receive` route's partial-payload bug and the purchase-invoice-delete status-revert bug.
- **Part 2 (historical migration)**: reconciling the 4 malformed legacy asset numbers, backfilling `purchase_files.asset_ledger_id`.
- **Part 3 (grading/QC workflow)**: a proper itemized QC checklist (`asset_qc_checks` table) doesn't exist — QC today is a single grade/status field on `asset_ledger`, set via `/api/asset-ledger/[id]/qc` and `/mark-ready`.
- **Part 4 (bulk historical purchase import + invoice-number constraint fix)**: not started. This requires the user to supply bank statements + WhatsApp invoice images before any import script can be built.
- **Warranty tracking**: schema exists (`asset_ledger.warranty_type`, `warranty_start_date`, `warranty_duration_months`, `warranty_expiry_date` — confirmed present in the live schema) but no UI/workflow reads or writes them yet.
- Sidebar badge/count indicator for pending paperwork (mentioned in an earlier plan revision, superseded by the in-page count banners on the Stock pages — not built as a separate sidebar badge).

## Known issues
- `sales.pmt` legacy column is dead but not dropped (harmless).
- `invoices.invoice_number` has two redundant unique constraints — not yet fixed (see Part 4 in the historical plan; blocks any future bulk-backfill of purchase invoices where one real invoice covers multiple migrated POs).
- Disposable test data from this session's live-HTTP verification methodology was found to have leaked into the real database in several spots (test auth users, test SKUs/asset_ledger rows, one stray finalized `sales` row + accessory + customer) because cleanup scripts' own "done" output wasn't re-verified against the DB. **This has now been cleaned up** (swept every table, confirmed zero test-named residue, confirmed only the 2 real accounts remain in `auth.users`) — but the process gap is real and is now called out explicitly in `CLAUDE.md`'s testing conventions.

## Exact next recommended steps
1. If continuing the historical plan: Part 4 (bulk purchase backlog import) needs the user to supply bank statements/invoice images first — nothing to build until that happens.
2. Otherwise, the highest-value remaining gap is probably the QC checklist (Part 3) — today's grading is a single field, no itemized inspection trail.
3. Re-audit for the dead tables/mechanisms listed above and remove them if still zero-referenced (quick, low-risk cleanup).
4. Confirm whether `asset_ledger` actually has the `warranty_*` columns from early planning before assuming they exist.

## Pending decisions
- Whether/when to "connect the strings" between Live Stock (employee_intake) and the main ERP Stock (legacy/PO) — explicitly deferred by the user until their manual reconciliation of old data is done.
- Whether the invoice-number unique-constraint fix (Part 4) is still needed depends on whether the bulk historical-purchase-import work happens at all.
