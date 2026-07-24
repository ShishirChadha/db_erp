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
  └─ purchase_invoices (invoices)   │     └─→ invoices (invoice_type='sales', entity_key)
                                    ├─→ repair_jobs (repair / replacement / return-adjacent)
                                    └─→ asset_rma_events (vendor returns, customer returns)

business_profiles (Digitalbluez/Techtenth/Cash) ──→ invoices.entity_key, sales_documents.entity_key
                                                  ──→ invoice_sequences (per-entity, per-doc-type numbering)
sales_documents (quotation/proforma) ──→ sales_document_items ──→ sales (on conversion, per line)
document_sends ──→ audit log of every invoice/quotation email (or future WhatsApp) send attempt
sku_master (accessory categories: RAM/SSD/CPU/GPU/KBD/MOUSE/ACC) ──→ stock_movements (quantity ledger, no per-unit asset_ledger row)
customers ──→ sales, repair_jobs, invoices, sales_documents
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
Employee records a sale via `/dashboard/entry/sell` → `POST /api/sales-entry`. This is final immediately: the unit (or accessory) leaves stock at that moment (status → `sold`, `stock_movements`/`accessory_movements` write immediately). The GST invoice is separate, deferred bookkeeping: owner calls `POST /api/sales/[id]/finalize` (one sale) or `POST /api/sales/finalize-batch` (2+ sales, same customer + same entity, combined into one multi-item invoice) whenever — these mint the invoice and mark the relevant `sales.finalized=true` — they do **not** touch inventory again (that already happened at sale time).

Payment tracking is independent of invoicing: `sales.payment_status` (`pending`/`partial`/`paid`), `amount_paid`, `payment_account` (which of Digitalbluez/Techtenth/Cash received the money — orthogonal to `sale_type` GST/Cash, and also the signal `finalize` uses to resolve which `business_profiles` entity issues the invoice), and `sold_by` (plain text staff name for incentive attribution, not tied to a login account).

The **Sales Ledger** (`/dashboard/sales`, owner-only) is the transactional/financial view of every sale (payment state, invoice status, editable, multi-select → combined invoice). This is distinct from the **Sold Stock** tab on Live Stock/Stock (inventory/warranty view — "which unit, sold when, to whom").

### Business entities & GST (`business_profiles`)
Digitalbluez, Techtenth, and Cash are each a row in `business_profiles` (`key`, `legal_name`, `address`, `state`/`state_code`, `gstin`, `is_gst_registered`, `logo_url`/`signature_url`/`stamp_url`, `bank_details` jsonb, `invoice_prefix`/`quotation_prefix`/`proforma_prefix`, `invoice_number_format`) — managed in Settings → Business Profiles, owner-only. Digitalbluez is GST-registered (GSTIN `09AAICD2790D1ZM`, Uttar Pradesh); Techtenth and Cash are not, so their invoices render as a "Bill of Supply" with no tax.

GST classification (`lib/gstCalculation.ts`, `lib/invoice-finalize.ts`, `lib/sales-documents.ts`) compares the entity's `state_code` against the place of supply (customer's GSTIN state code if B2B, else the entity's own state) — same state → CGST+SGST, different → IGST.

All document numbering (sales invoices, quotations, proformas) goes through one atomic RPC, `next_document_number(entity_key, doc_type, financial_year)`, backed by `invoice_sequences` keyed on `(entity_key, doc_type, financial_year)`. Numbers are server-minted only, never client-editable, never reused. Digitalbluez's real sales-invoice series continues Zoho's legal numbering unbroken (seeded at 680, so the ERP's first invoice is `DBI2026/27-00681`).

### Quotations & Proforma Invoices (`sales_documents`, `sales_document_items`)
A non-committal price offer (quotation) or a provisional-not-a-tax-invoice document (proforma), created at `/dashboard/quotations` (owner-only). Line items reference a **SKU** (not a specific physical unit — refurb units are qty-1/unique, so locking a serial number at quote time could strand it). Converting a line hands off to the normal `/dashboard/entry/sell` flow (customer + price pre-filled) rather than creating a sale/invoice directly — this keeps `POST /api/sales-entry` as the single place a unit ever gets marked sold. `sales_document_items.converted`/`sale_id` are set per-line on conversion, so partial conversion (some lines sold, others still open) falls out naturally. `sales_documents.status` (draft/sent/accepted/rejected/expired/void) is a real stored field — unlike most status-like facts in this app, a quotation's own lifecycle has no other table to derive it from.

### Sharing invoices/quotations (`document_sends`)
An "Email" button on invoices and quotations sends the PDF via Resend (`lib/email.ts`) and logs every attempt (success or failure) to `document_sends`. WhatsApp sharing is schema-ready (`document_sends.channel` accepts `'whatsapp'`) but not implemented — deferred pending Meta Business verification.

### Reassigning a unit's SKU, and tracking upgrade cost (`asset_cost_adjustments`)
A physical unit can be upgraded after intake (more RAM added, a bigger SSD swapped
in) before resale, so its real spec no longer matches the SKU it was originally
logged under. `components/FixSkuDialog.tsx` (used both by Stock view's owner-only
"Fix SKU" and Sell's "Change SKU", open to both roles) lets the seller search for
an existing SKU or create a new one (`SkuFormModal`), then reassigns the asset (or
its whole PO line item, if shared) via `PATCH /api/asset-ledger/[id]/reassign-sku`
— which also writes the compensating `stock_movements` rows so both the old and
new SKU's `quantity_in_stock` stay correct. If the owner is present, an optional
cost field records what the upgrade cost into `asset_cost_adjustments` (append-only,
same idiom as `stock_movements`/`asset_qc_checks` — supports multiple upgrades over
a unit's life with an audit trail), surfaced via an owner-only panel on the asset
detail page (`/dashboard/stock/[id]`) alongside the original `cost_price`.

### Accessories (`sku_master` + `stock_movements` — no separate table)
Accessories (RAM, SSD, CPU, GPU, keyboard, mouse, and anything else via the generic `ACC` category) are `sku_master` rows like a laptop, not a separate catalog — see `docs/decisions.md` (2026-07-23) for why the earlier `accessories`/`accessory_movements` table pair was retired. They're tracked purely via `stock_movements` (trigger-maintained `sku_master.quantity_in_stock`) with **no `asset_ledger` row** — fungible/quantity-only items don't need per-unit serial/QC/warranty tracking. A newly employee-created accessory SKU is immediately live and sellable, same as a new laptop SKU (`/dashboard/accessories`); the owner attaches a real vendor/PO/cost later via a deferred-PO-attach step (one `purchase_order_items` line, `quantity = N`, no per-unit asset number), mirroring `/api/purchase-orders/from-intake`'s "employee stock-in now, owner paperwork later" pattern.

### Activity Hub (`activities`, `activity_assignees`) — shared task/collaboration model

`activities` is a shared, assignable task model — `created_by` is the author; zero-to-many rows in `activity_assignees` (own table, `UNIQUE(activity_id, user_id)`) are who it's assigned to; an empty assignee set is a personal task (visible only to its creator and the owner). Enforcement is API-layer, `supabaseAdmin` + `getSessionUser()` (Bearer token via `apiFetch`), matching the rest of the app — RLS on both tables is the same permissive "backstop, not the boundary" policy used by `purchase_orders`/`asset_ledger`/`field_corrections`, not the restrictive per-`user_id` policies it used to have. Visibility rule (computed server-side in every route, `lib/activities.ts`'s `buildOwnVisibilityFilter`/`canSeeActivity`): owner sees every task; an employee sees only what they created or are assigned to. Any user with `activities` page access can assign a task to any other active user (not self-assign-only).

Fields beyond the original list/tags/status/due/reminder set: `priority` (`low`/`normal`/`high`/`urgent`), an optional loose link to a business record (`related_type` ∈ customer/sale/purchase_order/asset/repair_job/invoice/vendor + `related_id`, polymorphic text/uuid pair with a both-or-neither CHECK — same idiom as `payment_account`, no FK), `completed_at`/`completed_by` (auto-set/cleared on the `status` transition into/out of `'done'`), `reviewed_at`/`reviewed_by` (owner-only acknowledgement via a distinct `mark_reviewed` action, separate from general field edits), and `is_deleted` (soft-delete — creator or owner only; the row and its history survive).

Field-level audit reuses the existing `field_corrections` table (`lib/field-corrections.ts`) rather than a new event log — every tracked-field edit (title/description/status/priority/due_date/related_*) and every assignee-set change (logged as one summarized `field: 'assignees'` entry, old/new as joined display names) writes a row there, surfaced as a history timeline on `GET /api/activities/[id]`.

**Comments and notifications (Phase 2, live):** `activity_comments` (`activity_id`, `author_id`, `body`, `mentioned_user_ids uuid[]`, soft-delete, `edited`) — CRUD gated by the same task-visibility rule, edit/delete author-or-owner only. `@mentions` are restricted server-side to users who can already see the task (its assignees, its creator, or any owner) — mentioning anyone else is rejected (400), since a mention that granted a dead-end link would be worse than no mention. A **generic**, not activity-specific, `notifications` table (`recipient_id`, `type`, `actor_id`, nullable `activity_id`/`comment_id`, `title`, `body`, `link`, `read_at`) is the one notification mechanism for the whole app — any future module enqueues a row via `link` + its own nullable refs rather than building its own notifier. `lib/notifications.ts` (`notify`/`notifyMany`) is the single fan-out point: inserts the row, then best-effort emails the recipient via `sendEmail()` (`lib/email.ts`, the no-attachment sibling of the existing Resend-backed invoice-email wrapper — same no-op-until-configured posture). Producers: task creation with assignees (`task_assigned`), a later reassignment add (`task_reassigned`), a status change to current assignees+creator (`status_changed`, never self-notifies the actor), and a new comment to assignees+creator (`comment_added`, upgraded to `mention` for anyone actually `@mentioned` so one comment never double-notifies the same recipient).

**Due-soon/overdue reminders, attachments, reactions, pinning (Phase 3, live — closes the redesign):** a Supabase `pg_cron` job (`scan_activity_due_dates()`, every 15 minutes) notifies a task's creator + assignees when it's due within 24h (`due_soon`) or already overdue (`overdue`) — **in-app only, not emailed** (would need `pg_net` calling the app's public URL, not set up). `activities.due_soon_notified_at`/`overdue_notified_at` dedup the reminder per task and reset to `NULL` on a `due_date` change or on reopening a done/cancelled task, so a task always gets exactly one fresh reminder cycle per due date rather than firing once and going silent forever. The scan function claims each row atomically (`UPDATE ... WHERE marker IS NULL RETURNING ...` as its own loop source) specifically to survive an overlapping execution (verified live: a manual test call did race the real scheduled tick) without double-notifying. `activity_comments` gained `attachments jsonb` (reusing the existing `/api/storage/*` signed-URL pattern verbatim) and `pinned`/`pinned_by`/`pinned_at` — pinning is a task-level curation action (owner/creator), distinct from editing a comment's own body (author/owner). New `activity_comment_reactions` (toggle per comment/user/emoji, fixed palette validated server-side).

Client/external sharing was explicitly considered and **deferred** — internal collaboration only. Full target data model, permission table, and phased build plan: `~/.claude/plans/stateless-shimmying-pearl.md`; build record: `docs/decisions.md` (2026-07-24, "Activity Hub redesign" + Phase 1/2/3 "built" entries).

UI: `components/ActivityList.tsx` (table + filters, priority, assignee picker, related-record link, owner-only Created-By column and Mark Reviewed action, change-history view, reads a `?open=<id>` query param to deep-link into a task from a notification), `components/ActivityCommentThread.tsx` (comment thread + `@mention` autocomplete scoped to the same allowed-mention pool the server enforces, file attachment upload/download, pin/unpin, emoji reactions), `components/NotificationBell.tsx` (sidebar header, both desktop and mobile since they share one memoized nav element — unread badge, 30s poll, mark-read/mark-all-read, composes all 7 notification types), `components/ActivityCalendar.tsx` (FullCalendar), `app/dashboard/activities/page.tsx` (List/Calendar tabs, 60s client-side reminder-toast poll — reminders fire for tasks the caller created or is assigned to, not just self-authored ones).

**Not the same system: Pending Tasks** (`/dashboard/pending-tasks`). A **derived** cross-module checklist (QC-pending stock, in-progress repair jobs, open RMA, payment-pending sales, needs-PO, needs-invoice) computed live from other tables at request time — it stores nothing of its own and must stay that way (matches this project's "paperwork completeness is always derived" principle). It is not part of, and should not be merged into, the Activity Hub.

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
| Edit SKU master specs, manage vendors, manage dropdown-option lists | ❌ | ✅ |
| Reassign a unit's SKU ("Fix SKU" / Sell's "Change SKU") | ✅ | ✅ |
| Record/view an asset's upgrade cost adjustments | ❌ | ✅ |
| View Sales Ledger, Stock (Main ERP), RMA (vendor returns) | ❌ (page-gated) | ✅ |
| Create a new accessory SKU / add a new customer (lightweight fields) | ✅ | ✅ |
| Attach an accessory SKU's stock-in to a real PO/vendor/cost | ❌ | ✅ |

Note the split above: **reassigning** which SKU an asset points to is open to both
roles (it never reads or writes cost/vendor data), while **editing** a SKU's own
master-data specs remains owner-only. This is why "Fix SKU" (Stock view) and Sell's
"Change SKU" both call the same `PATCH /api/asset-ledger/[id]/reassign-sku` without
an owner check, even though `PUT /api/sku-master/[id]` (editing specs) still is.

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
- The 751 historically-migrated `purchase_orders` rows have no linked `invoices` (purchase-side) rows at all — by design, not a bug (see `docs/decisions.md`), but still an open backlog item for the owner.
- No automated test suite. All verification during development was manual (browser) + disposable live-HTTP scripts against a running dev server, cleaned up after each run.
- Email sending (invoices/quotations) is fully built but not yet live — needs a Resend account, a verified sending domain, and `RESEND_API_KEY`/`RESEND_FROM_EMAIL` in the environment. See `docs/CHANGELOG.md` (2026-07-23 entry).
- WhatsApp sharing is schema-ready (`document_sends.channel` accepts `'whatsapp'`) but not implemented — deferred pending Meta Business verification (2-4 week external process).
- `components/InvoiceForm.tsx` (the manual multi-item invoice form) is hardcoded to Digitalbluez's state code for GST classification — no entity picker yet. Low priority: the main sell→finalize flow already resolves the entity correctly from `payment_account`.
- `docs/reconciliation_decisions.md` (pre-existing file, dated 2026-07-20) documents an earlier round of ADR-style decisions (trigger-based stock cache, RLS floor-raise, etc.) that were partially superseded/operationalized by the work described in `docs/decisions.md` — treat the newer file as authoritative where they overlap.

## Important assumptions
- This Supabase project is a **dev/staging copy**, not the live production database, per explicit user confirmation — schema changes here don't need a production-cutover safety margin, but the same migration steps should be re-verified against whatever project is actually production before that cutover happens.
- The owner is currently reconciling "current and old stock" (the historical/legacy/PO-migrated data) manually, outside the new employee-facing flow, on their own timeline — the new Live Stock/Sell/Service system and the old Stock/Sales data are expected to stay disconnected until the owner explicitly decides to "connect the strings."
