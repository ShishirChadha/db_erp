# Current Progress

Last updated: 2026-07-24 — Data-integrity hardening pass (10-item priority list
from the architectural review in `~/.claude/plans/stateless-shimmying-pearl.md`).
See the newest ADR in `docs/decisions.md` (2026-07-23, "Data-integrity hardening
pass") for the full per-item rationale. Summary below, then the earlier
Sales/Invoice/Quotation redesign history.

## Data-integrity hardening pass — COMPLETE (except deferred items)

Nine of ten priority items built and verified end-to-end (disposable script, 34
checks all passing, cleanup re-queried, Digitalbluez legal invoice counter
confirmed untouched at 680); `npx tsc --noEmit` + `npm run build` clean. The tenth
(repair/replacement GST invoicing) was deliberately left unbuilt pending an owner
decision — it's new feature work, not a data-integrity gap.

- **Duplicate-serial prevention** (`lib/duplicate-serial.ts`): warn-then-confirm on
  Stock Intake / PO Receive / Stock edit; hard block for employees on a `sold`
  duplicate. DB-level partial unique index **deferred** — 7 real legacy duplicate
  serials already exist and need the owner's manual reconciliation (a dedup sweep)
  before a live constraint can be added safely. **Owner action item.**
- **Post-invoice correction guards** on `reassign-sku` and sale-price edit
  (`already_invoiced` → confirm to override).
- **PO wizard accessory landmine** closed (UI category filter + server-side reject
  in `submit`). Also fixed a live regression: `lib/invoice-finalize.ts` still
  queried the dropped `accessories` table (would have crashed accessory-sale
  invoicing) — repointed to `sku_master`.
- **`repair_job_parts` rebuilt** on `sku_master`/`stock_movements`; "Parts Used"
  picker added to the Service form (oversell-guarded).
- **Configuration summary** (`lib/sku-config-summary.ts`) now shown on Stock, SKU
  Master, and the Sell unit picker; warranty fields surfaced on the asset detail
  page. Pure function, no schema change.
- **New `ADP` (Adapter/Charger) structured category**; accessory-category lists are
  now `RAM,SSD,CPU,GPU,KBD,MOUSE,ACC,ADP`.
- **Accessory correction UI**: "Correct Quantity" (adjustment movement) + archive/
  reactivate (`sku_master.status`, previously unwritable via the API).
- **"Under Repair" badge** on Stock/Live Stock (derived from open `repair_jobs`).
- **Zoho historical invoice import** (`POST /api/invoices/import`, owner-only, new
  `invoices.source`/`imported_by`/`imported_at`) — real numbers preserved verbatim,
  never touches the live counter. New "Import Historical Invoice" screen.
- **Generalized `field_corrections` audit table** (`lib/field-corrections.ts`) wired
  into serial/sale/SKU-master edits.

Open follow-ups from this pass (all previously flagged, none blocking):
1. Owner to reconcile the 7 pre-existing duplicate serials, then a live partial
   unique index on `asset_ledger.serial_number` can be added.
2. Repair/replacement GST invoicing — build if/when the owner wants it.

---

## Sales/Invoice/Quotation redesign — COMPLETE (earlier, same session)

(see `~/.claude/plans/stateless-shimmying-pearl.md` — note that plan file has since
been overwritten with the architectural-review analysis; the redesign history below
is the record.) **All 5 phases complete** (Foundation, Sales↔Invoice
lifecycle, Quotation/Proforma, Sharing, Cleanup). Each closed with a clean
production build. **Phase 4's email sending needs one thing from the owner
before it can send a real email — see that section below.** Status further
down (Phase 5 first, then 4, 3, 2, 1).

## Phase 5 (Optional cleanup) — COMPLETE

**Scope**: only the specific cleanup items the plan named (dead trigger
functions, unused `sale_items` table, redundant `invoices.invoice_number`
constraint). The plan's "extras" (credit notes for returns, service/repair
GST invoices) were **not** built — those are new features, not cleanup, and
weren't explicitly agreed for this pass.

Re-verified every item immediately before touching anything (a live trigger
listing, a live `sale_items` row count, and a grep across app/lib/components
for any reference) rather than trusting the original Phase-1 analysis was
still accurate several phases later:
- **3 orphaned trigger functions dropped** (`create_assets_on_receive`,
  `decrement_inventory_on_asset_sold`, `update_inventory_on_asset_creation`)
  — confirmed none of the 5 real triggers actually wired in this database
  use them; they referenced tables/columns (`assets`, `sku_inventory`,
  `purchase_line_items`, `sku_variant_id`) that don't exist anywhere in the
  current schema, leftovers from an earlier, since-replaced design.
- **`sale_items` table dropped** — confirmed 0 rows and zero code references
  anywhere. Bonus: this was flagged as an ERROR-level "RLS disabled" finding
  by Supabase's advisors; dropping it is a genuine security-posture
  improvement; confirmed via `get_advisors` after the migration that this
  specific ERROR is gone.
- **Redundant duplicate unique constraint dropped** —
  `invoices_invoice_number_unique` removed (was byte-for-byte the same
  constraint as `invoices_invoice_number_key`, which stays and remains the
  one enforcing invoice-number uniqueness).

Backed up first (`backups/20260723_phase5_dead_code_cleanup_schema_backup.sql`).
Verified via direct SQL after the migration (all three functions gone,
`sale_items` gone, only the one real constraint remains) and
`get_advisors` (no new issues; the `sale_items` ERROR is gone; all other
findings pre-existing and untouched). `npx tsc --noEmit` clean (expected —
nothing in application code ever referenced any of this). Production build
passed clean (dev server stopped for the build, cleanly restarted after).

**This closes the full Sales/Invoice/Quotation redesign** described in
`~/.claude/plans/stateless-shimmying-pearl.md`. Remaining open items across
the whole effort, all previously flagged, none blocking:
1. Resend setup for real email delivery (see Phase 4 below).
2. Entity picker on the manual `InvoiceForm.tsx` (still hardcoded to
   Digitalbluez — low priority, the main sell→finalize flow is unaffected).
3. Logo/signature/stamp images are stored but not yet embedded into the
   rendered PDFs (visual polish, not a correctness gap).
4. WhatsApp sharing (explicitly deferred — needs Meta Business verification).
5. The plan's Phase 5 "extras" (credit notes, service/repair GST invoices) —
   never started, would be new feature work if wanted later.

## Phase 4 (Sharing: email + WhatsApp) — CODE COMPLETE, awaiting Resend setup

**Scope decision (owner, this session):** build email against Resend now;
**skip WhatsApp entirely** (Meta Business verification is a 2-4 week
external process needing the owner's business documents — out of scope for
this pass, revisit later as a separate request if wanted).

**⚠️ ACTION NEEDED FROM OWNER before real emails can send:**
1. Sign up at resend.com (free tier is fine to start).
2. Verify a sending domain there (Resend gives you a few DNS records to add).
3. Add two lines to `.env.local` (and to whatever env the app runs in
   eventually): `RESEND_API_KEY=<your key>` and
   `RESEND_FROM_EMAIL=<an address on the verified domain>`.
Until then, the "Email" buttons will show a clear
"Email is not configured yet" error — by design, not a bug (verified below).

**What was built:**
- **Refactor**: extracted the invoice PDF renderer out of
  `app/api/invoices/[id]/pdf/route.ts` into `lib/documents/renderInvoicePdf.ts`,
  and the quotation/proforma renderer out of
  `app/api/sales-documents/[id]/pdf/route.ts` into
  `lib/documents/renderSalesDocumentPdf.ts` — both the direct-download routes
  and the new email routes call the same function now, so there is exactly
  one place that draws each PDF (no duplicated jsPDF code, no drift risk).
- **`lib/email.ts`**: `sendEmailWithAttachment()` — a thin wrapper around
  Resend's plain REST API (`POST https://api.resend.com/emails`), no SDK
  dependency added. Returns a clear `{ success: false, error: 'not
  configured yet...' }` rather than throwing/crashing when
  `RESEND_API_KEY`/`RESEND_FROM_EMAIL` are missing.
- **Schema** (backed up first,
  `backups/20260723_document_sends_schema_backup.sql`): new `document_sends`
  table (document_type, document_id, channel `'email'|'whatsapp'`, sent_to,
  status `'sent'|'failed'`, provider_message_id, error_message, sent_by) --
  an append-only audit log of every send attempt, same idiom as
  `stock_movements`/`asset_qc_checks`. `channel` already supports
  `'whatsapp'` for when that phase happens later, but nothing writes it yet.
- **API**: `POST /api/invoices/[id]/email` and
  `POST /api/sales-documents/[id]/email` (both owner-only) -- render the PDF
  via the shared renderer, send via Resend, log the attempt (success or
  failure) to `document_sends` either way, return a clear error if sending
  failed.
- **UI**: "Email" button added next to "Download PDF" on the invoice detail
  page, the invoices list, and the quotations detail dialog -- each prompts
  for a recipient address (defaulting to the customer's email on file) and
  shows a clear success/failure message.

**Verified live** (disposable script, cleaned up, zero leftover rows):
employee correctly blocked (owner-only, same as invoice generation);
attempting to send with no Resend key configured returns a clear `502` with
message `"Email is not configured yet..."` (not a crash); the failed attempt
is correctly logged to `document_sends` with `status='failed'` and the
real error message; **the PDF download routes still work correctly after
the renderer-extraction refactor** (this was the main regression risk of
this phase, since both routes now share code that previously existed only
inline). `npx tsc --noEmit` clean. Production build passed clean (dev server
stopped for the build, `/api/invoices/[id]/email` and
`/api/sales-documents/[id]/email` confirmed present in the route list, dev
server cleanly restarted after). **Real email delivery has NOT been tested**
end-to-end -- that requires the owner's Resend account + verified domain,
which don't exist yet; the moment those two env vars are set, no code
changes are needed for it to start working.

**Not done in this phase (explicit scope cuts, confirmed with owner):**
WhatsApp sending entirely (schema is ready for it -- `document_sends.channel`
already accepts `'whatsapp'` -- but no Meta integration, no templates, no UI
button); a "resend"/retry button reading from the `document_sends` log; rate
limiting or a max-sends-per-day guard on the email routes.

## Phase 3 (Quotation / Proforma Invoice) — COMPLETE

Genuinely greenfield -- no existing table/workflow to extend, unlike Phases
1-2. Built the full pre-sale document workflow the plan called for.

**Key design decision**: conversion never creates a sale or invoice directly.
A quotation/PI line references a **SKU** (not a specific physical unit --
refurb units are qty-1/unique, so locking a serial number at quote time could
strand that unit if the quote is never accepted). Converting a line just
hands off to the **existing** `/dashboard/entry/sell` page (customer + price
pre-filled via query params, SKU pre-filled into the unit search) where the
owner picks the actual physical unit, going through the exact same
`POST /api/sales-entry` path every other sale goes through. This means:
zero duplicated sale-creation logic, quotations/PIs feed the same
already-tested Phase 1/2 invoicing pipeline, and "partial conversion" falls
out for free (convert lines one at a time, in any order, leave the rest open).

**What was built:**
- **Schema** (backed up first, `backups/20260723_sales_documents_schema_backup.sql`):
  `sales_documents` (doc_type, document_number, valid_until, entity_key,
  customer snapshot fields, subtotal/total_gst/grand_total, status
  draft→sent→accepted/rejected/expired/void, is_deleted) +
  `sales_document_items` (sku_id/accessory_id, description, HSN, qty, rate,
  GST fields, `converted`/`sale_id` -- set per-line at conversion time).
  `status` is a real stored field here (unlike sales/invoices) because a
  quotation's own accepted/rejected/expired state has no other source of
  truth to derive it from; conversion progress, by contrast, IS fully
  derivable from `sales_document_items.converted` and is never stored on the
  parent document.
  Added `quotation_prefix`/`proforma_prefix` to `business_profiles` (seeded
  `QUO`/`PI` for all three entities) and taught the existing
  `next_document_number` RPC to pick the right prefix column per `doc_type`,
  with the `sales_invoice` branch's behavior left byte-for-byte identical.
- **`lib/sales-documents.ts`**: `mintSalesDocumentNumber()` (same atomic RPC,
  new doc_types) + `computeLineGst()` (fresh per-line GST estimate from
  quantity×rate×gst_rate and state-code classification, since a quotation
  line has no already-completed sale to derive its GST amount from the way
  an invoice line does).
- **API**: `GET/POST /api/sales-documents` (list/create, owner-only),
  `GET/PATCH /api/sales-documents/[id]` (fetch-with-items /
  status-and-metadata-only updates -- line items are immutable after
  creation; if the offer changes, void and recreate, preserving the original
  for audit), `GET /api/sales-documents/[id]/pdf` (new PDF, "QUOTATION" or
  "PROFORMA INVOICE" header, explicit "Not a Tax Invoice" disclaimer, no tax
  columns for a non-GST entity, includes `valid_until` for quotations).
- **`POST /api/sales-entry` extended**: accepts an optional
  `source_document_item_id`; on success, best-effort marks that
  `sales_document_items` row `converted=true` + `sale_id` (never blocks the
  sale itself on this secondary bookkeeping step failing, consistent with how
  bundled-accessory movements already work in this same route).
  `app/dashboard/entry/sell/page.tsx` extended to read `customer_id`,
  `source_document_item_id`, `prefill_rate`, `prefill_gst_rate`, `sku_search`
  query params (pre-fills customer/price/unit-search, shows a banner, passes
  `source_document_item_id` through on submit).
- **UI**: new `/dashboard/quotations` page (owner-only) -- type tabs
  (Quotations / Proforma Invoices), create dialog (entity picker, customer
  picker via the existing `SearchableCustomerSelect`, SKU search reusing
  `/api/sku-master?search=`, custom line support, live subtotal/GST/total),
  list table with conversion progress ("2/3 converted"), detail dialog
  (status transitions, PDF download, per-line "Convert →" opening the Sell
  page in a new tab). Sidebar nav entry added (owner-only).

**Verified live** (disposable script, cleaned up, zero leftover rows;
deliberately used the **real** Digitalbluez entity for this phase's test,
since quotation/proforma numbering uses its own separate counter and cannot
touch the `sales_invoice` counter at all -- confirmed still exactly 680
afterward): employee correctly blocked from creating a quotation; quotation
number format `QUO2026/27-00001` correct; GST math correct (₹25,000 line,
18% → ₹4,500, correctly split CGST+SGST for the intra-state case); PDF
generates correctly; status transition to `accepted` works; converting the
line through the real `sales-entry` route correctly created a real sale AND
marked the `sales_document_items` row `converted=true` with the right
`sale_id`. `npx tsc --noEmit` clean throughout. Production build passed
clean (dev server stopped for the build, all new routes/`/dashboard/quotations`
confirmed present in the route list, dev server cleanly restarted after).

**Not done in this phase (acceptable scope cuts):** editing line items after
a document is created (void-and-recreate is the intended path instead); an
"expired" auto-transition when `valid_until` passes (would need a cron/edge
function -- status stays whatever it was until an owner manually changes it,
or a customer accepts/rejects); allocating multiple physical units
automatically for a quantity>1 SKU line (the owner converts one unit at a
time via the Sell page, which is how quantity>1 refurb-unit lines would
realistically be handled anyway).

## Phase 2 (Sales↔Invoice lifecycle / multi-item invoicing) — COMPLETE

## Phase 2 (Sales↔Invoice lifecycle / multi-item invoicing) — COMPLETE

**Key discovery going in**: the "legacy `/dashboard/sales` manual Add Sale"
the plan expected to need retiring turned out to already be dead —
`app/dashboard/sales/sales-client.tsx` (the flat-column, direct-to-Supabase,
racy-invoice-number writer) was **not imported by `app/dashboard/sales/page.tsx`
at all**; the real live Sales Ledger page is already a proper Gen-2
implementation (API-based, per-row single-sale "Generate Invoice" via the
existing finalize route). Deleted the dead file — no retirement work needed.

**What was built:**
- `lib/invoice-finalize.ts` (new): extracted `resolveEntityKey()`,
  `classifyGst()`, `resolveSaleItemDescriptor()` (validates the linked
  unit/accessory exists, throws before any invoice/number is created if not),
  and `buildInvoiceItemRow()` out of the single-sale finalize route so both it
  and the new batch route share identical, single-sourced GST/line-item logic
  (no drift risk between the two).
- `app/api/sales/[id]/finalize/route.ts`: refactored to use the shared lib
  (behavior unchanged, now ~60 lines shorter); also fixed a **latent bug**
  (see below) where the final `sales` update's error was never checked.
- **New `POST /api/sales/finalize-batch`**: owner-only, takes `sale_ids: string[]`
  (≥2 required), validates all exist/none already finalized/all same
  customer/all same entity (`payment_account`), resolves every sale's line
  item and validates its linked unit/accessory exists **before** minting any
  number, mints **one** invoice number, aggregates `subtotal`/`total_gst`
  across all lines and `grand_total` across all sales, inserts one
  `invoice_items` row per sale, and marks every sale `finalized=true` pointing
  at the same `invoice_id`/`invoice_number`.
- **Sales Ledger UI** (`app/dashboard/sales/page.tsx`): added a checkbox
  column on un-finalized sales, a selection-count "Generate Combined Invoice"
  button (appears once ≥2 are selected), wired to the new batch route.

**Bug found and fixed during live testing** (a real, previously-undetected
issue, not introduced by this phase): `sales.invoice_number` carried a
**UNIQUE constraint** (`sales_invoice_number_key`) left over from the old
one-sale-always-gets-its-own-invoice assumption. The moment two sales tried
to share one invoice number (exactly Phase 2's purpose), the final `sales`
update failed with a duplicate-key violation -- and because **neither**
finalize route checked that update's error (a bug that also silently existed
in the single-sale route from Phase 1, just never triggered/caught until this
phase's stricter testing), the invoice + invoice_items would have been
created while the sales rows silently stayed `finalized=false`, invisible
until an owner noticed a sale not marked done. Fixed in two parts, each
backed up first:
  1. Both finalize routes now check and surface this update's error instead
     of swallowing it.
  2. `backups/20260723_drop_sales_invoice_number_unique_schema_backup.sql` +
     migration `drop_obsolete_sales_invoice_number_unique_constraint`: dropped
     `sales_invoice_number_key`. **The real uniqueness guarantee for invoice
     numbers is untouched** -- it correctly lives on `invoices.invoice_number`
     (`invoices_invoice_number_key` / `invoices_invoice_number_unique`, the
     pre-existing redundant pair noted in `docs/project-context.md`'s known
     limitations -- still both present, still not addressed, out of scope
     here).

**Verified live** (disposable script, Techtenth entity specifically to avoid
touching the real Digitalbluez counter, cleaned up, zero leftover rows):
2 real sales for one customer correctly combined into one invoice with
correct aggregated `subtotal`/`total_gst`/`grand_total` and 2 `invoice_items`
rows; both sales correctly marked `finalized` pointing at the shared invoice;
rejects <2 `sale_ids`; rejects re-finalizing already-finalized sales; rejects
mixed-customer batches. Confirmed real Digitalbluez `sales_invoice` counter
still exactly 680 throughout. `npx tsc --noEmit` clean. Production build
passed clean (dev server stopped for the build, `/api/sales/finalize-batch`
confirmed present in the route list, dev server cleanly restarted after).

**Not done in this phase (acceptable scope cuts):** true multi-row DB
transaction safety between invoice-creation and the sales-update step (a
failure between them still leaves an orphaned invoice+items, same
accepted risk profile as the pre-existing single-sale route -- would need a
Postgres RPC to fully close); derived-state UI surfacing beyond what already
exists (finalized checkmark + invoice number shown per row).

## Phase 1 (Foundation) — COMPLETE

**Additional work completed in the third pass (same day), on top of the two
passes documented further below:**
- Fixed the "Download PDF" buttons on both `/dashboard/invoices` (list) and
  `/dashboard/invoices/[id]` (detail) — they now call the new authenticated
  `GET /api/invoices/[id]/pdf` route via `apiFetch` (blob → object URL),
  instead of the old client-side `generateInvoicePDF` (wrong hardcoded
  identity) or a plain `window.open()` (which never carried the auth Bearer
  token and would have 401'd).
- **Found and removed a second, previously-undiscovered dead PDF route**:
  `app/dashboard/invoices/[id]/pdf/route.ts` — a stray Next.js route handler
  living under the `dashboard` tree (Next.js treats any `route.ts` as an
  endpoint regardless of parent folder). It was unreferenced by any UI, used
  the old wrong-identity generator, AND had **no auth/role check at all**
  (used the cookie-based server client directly) — a real, if unexploited,
  data-exposure gap. Deleted along with the now-fully-unused
  `lib/generateInvoicePDF.ts`.
- Extracted `lib/gstStateCodes.ts` (`STATE_CODE_TO_NAME` map,
  `stateCodeFromGstin()`, `stateNameFromCode()`) shared by the PDF route and
  the GST lookup route.
- **Hardened `app/api/gst/route.ts`**: it previously had **no auth check at
  all** (any caller, even unauthenticated, could hit it) and no caching. Now
  requires a valid session (open to both roles — customer creation is a
  lightweight action for both, per the existing permission model) and derives
  `state`/`state_code` directly from the GSTIN's own first two digits
  (authoritative by GST design, independent of whether the external lookup
  provider succeeds) plus a small in-process 24h cache per GSTIN.
- **Wired GSTIN auto-fill into all three customer forms**
  (`AddCustomerDialog.tsx`, `QuickAddCustomerDialog.tsx`,
  `EditCustomerDialog.tsx`): each now has a "Fetch" button next to GST Number
  that calls the hardened route and fills legal name/address/state/state_code
  (`customers.state`/`state_code` — added in the first migration — were not
  previously surfaced in any form's local state; now they are).
- **Built the Business Profiles Settings UI**: new owner-only
  `GET /api/business-profiles` + `PATCH /api/business-profiles/[key]` routes,
  new `components/BusinessProfileManager.tsx` (edit legal name/address/
  state/state_code/GSTIN/GST-registered toggle/bank details/invoice prefix,
  plus logo/signature/stamp upload reusing the existing
  `/api/storage/upload-url` + `/api/storage/download-url` signed-URL pattern
  already used by `FileUpload.tsx`), wired into Settings as a new
  "Business Profiles" category alongside Asset Numbering/Dropdown
  Options/Users & Access.
  **Scope cut**: uploaded logo/signature/stamp images are stored (as storage
  keys) and viewable in Settings, but are **not yet embedded into the
  rendered PDF** — the PDF renders correctly today without them (text-only
  seal), embedding images is a visual-polish follow-up, not a correctness gap.
- **Verified live** (disposable script, cleaned up, zero leftover rows):
  `/api/gst` correctly 401s unauthenticated, correctly derives state_code=`09`/
  state=`Uttar Pradesh` for Digitalbluez's own GSTIN regardless of the
  external provider's status, and is reachable by an employee session;
  `/api/business-profiles` correctly 403s an employee and returns all 3
  profiles for an owner; a real PATCH + revert round-trip confirmed writes
  work and left no residual change to real Settings data.

**Production build**: dev server was stopped cleanly (`npm run dev`'s process
tree killed by PID, port 3000 confirmed free), `npm run build` run standalone
— **compiled successfully, TypeScript passed, all pages/routes generated
correctly**, including the new `/api/business-profiles`,
`/api/business-profiles/[key]`, `/api/gst`, `/api/invoices/[id]/pdf` routes,
and confirming the deleted dead `/dashboard/invoices/[id]/pdf` route no
longer appears in the build's route list. Dev server restarted immediately
after (`nohup npm run dev`, backgrounded) and confirmed back up on
`localhost:3000`.

**Only remaining item (optional, low priority, not blocking):**
`components/InvoiceForm.tsx` (the manual multi-item invoice form) is still
hardcoded to Digitalbluez's state code (`09`) for GST classification — a
`TODO` comment marks this. Now that the Business Profiles UI exists, a real
entity `<Select>` could replace the hardcode. Low priority because the manual
form is a secondary path; the main sell→finalize flow already resolves the
entity correctly from `payment_account`.

**Phase 1 is done. Next: report to the owner, then move to Phase 2
(Sales↔Invoice lifecycle / multi-item invoicing from Live Sold) once
approved.**

---

## Phase 1 — first two passes (schema + core backend fixes), same day

**Done (2026-07-23, across two sessions same day):**

*Schema (2 migrations, both backed up first):*
- `backups/20260722_business_profiles_schema_backup.sql` — `business_profiles`
  table (key/legal_name/address/state/state_code/gstin/is_gst_registered/
  logo_url/signature_url/stamp_url/bank_details jsonb/contact jsonb/
  invoice_prefix/invoice_number_format/default_terms/default_notes/active),
  seeded: `digitalbluez` (GST, GSTIN 09AAICD2790D1ZM, UP/09, ICICI bank
  details, prefix `DBI`), `techtenth` (non-GST, prefix `TTI`, address/gstin/
  bank NULL for owner to fill in later), `cash` (non-GST, prefix `CSH`).
  Also added `customers.state`/`state_code` (nullable) and
  `invoices.entity_key REFERENCES business_profiles(key)` (nullable, existing
  13 invoice rows untouched).
- `create_business_profiles_foundation` + `generalize_invoice_numbering` +
  `fix_invoice_sequences_prefix_collision` migrations: `invoice_sequences`
  generalized with `entity_key`/`doc_type` columns + a
  `(entity_key, doc_type, financial_year)` unique constraint (old
  `(prefix, financial_year)` constraint/row/RPC left untouched — the legacy
  DBIN test series is dead code going forward, not deleted). New
  `next_document_number(p_entity_key, p_doc_type, p_financial_year)` RPC:
  atomic upsert + template substitution (`{prefix}{fy}-{seq:5}`, `fy` rendered
  with `/` e.g. `2026/27`). **Seeded the real Digitalbluez sales-invoice
  counter at `last_number=680`** — confirmed via live test that the counter is
  still exactly 680 (untouched); the next real call will mint
  `DBI2026/27-00681`, continuing the owner's Zoho legal series unbroken.

*Code fixes:*
- `lib/sales-entry.ts`: fixed `financialYear()` (was `getFullYear()` ignoring
  month → wrong FY for Jan-Mar; now checks `getMonth() >= 3` for the
  April-March Indian FY). `mintSalesInvoiceNumber(entityKey)` now calls the
  new `next_document_number` RPC instead of the old `increment_invoice_number`.
- `lib/gstCalculation.ts`: `calculateGST()` no longer hardcodes
  `businessState='Delhi'` — now takes `placeOfSupplyStateCode` +
  `entityStateCode` and compares GST state codes directly (intra-state ⇒
  CGST+SGST, inter-state ⇒ IGST). `components/InvoiceForm.tsx` updated to
  call it with Digitalbluez's real state code (`09`) and a state code derived
  from the customer's GSTIN when present (falls back to intra-state
  assumption for B2C/no-GSTIN customers). Left a `TODO` for a proper entity
  picker on this form (currently hardcoded to Digitalbluez).
- Deleted the racy manual numbering entirely: `app/actions/invoice.ts`'s old
  `suggestNextInvoiceNumber()` (MAX-scan) and `isInvoiceNumberUnique()` are
  gone, replaced by one `mintInvoiceNumber(entityKey)` server action calling
  the atomic RPC. `app/dashboard/invoices/new/page.tsx` now mints the number
  atomically at actual submit time (not pre-fetched/editable).
  `components/InvoiceForm.tsx`'s invoice-number field is now a read-only
  display (`disabled`, shows "Assigned on save" until minted) — **no longer
  client-editable**, closing the "never editable" numbering rule violation.
- `app/api/sales/[id]/finalize/route.ts` fully reworked: derives the issuing
  entity from `sales.payment_account` (Digitalbluez/Techtenth/Cash — reusing
  the existing field rather than adding a new one), fetches that entity's
  `business_profiles` row, computes GST classification from real state codes
  (customer GSTIN state code vs entity state code, falling back to the
  entity's own state for GSTIN-less customers), and **for a non-GST entity
  (Techtenth/Cash) applies zero tax and presents the full amount as a plain
  taxable value** (Bill of Supply), per the confirmed business rule. Uses the
  new atomic RPC via `mintSalesInvoiceNumber(entityKey)`. Stores
  `entity_key` + `place_of_supply` on the invoice.
  **Scope cut**: still one-sale-one-invoice (multi-sale/multi-item finalize
  is Phase 2 — "Sales↔Invoice lifecycle & multi-item invoicing from Live
  Sold" — not done tonight, given time budget).
- New `GET /api/invoices/[id]/pdf` route (`app/api/invoices/[id]/pdf/route.ts`)
  — this is the **one unified, entity-aware PDF generator** for Phase 1: pulls
  the invoice + items + the correct `business_profiles` row, renders
  "TAX INVOICE" with GSTIN/tax columns/amount-in-words for a GST entity, or
  "BILL OF SUPPLY" with no tax columns/no GSTIN for a non-GST entity. Fixes
  the previously-broken "Download PDF" button on `/dashboard/invoices` (the
  route didn't exist before — 404). The invoice detail page
  (`/dashboard/invoices/[id]`) and the old `lib/generateInvoicePDF.ts` (wrong
  hardcoded "Digital Bluez"/placeholder-GSTIN identity) were **not yet**
  repointed at this new route — small follow-up.
- Deleted the confirmed-dead, orphaned `app/dashboard/invoices/invoices-client.tsx`
  (its own ad-hoc PDF generator had a *third*, different wrong identity —
  Bengaluru/Karnataka GSTIN — never actually imported anywhere).

*Verification:*
- `npx tsc --noEmit -p .` — clean, no errors.
- Live end-to-end test against the running dev server (owner auth, real HTTP
  calls to `/api/stock-intake` → `/api/sales-entry` → `/api/sales/[id]/finalize`
  → `/api/invoices/[id]/pdf`), using the **Techtenth** entity specifically so
  the test would NOT consume the real Digitalbluez counter (681) on fake data.
  Confirmed: invoice number format `TTI2026/27-00001` correct; `entity_key`
  correctly `techtenth`; `total_gst=0` and `subtotal===grand_total` (correct
  Bill of Supply behavior); line item `gst_type=null`; PDF route returns a
  real `application/pdf` response (7.3KB). **Confirmed the real Digitalbluez
  `sales_invoice` counter is still exactly 680 after the test** (untouched).
  Cleanup: hit one FK-ordering bug in the *test script itself* (deleted
  `invoices` before `sales`, and `sales.invoice_id` still referenced it,
  silently failing) — fixed, re-verified zero leftover rows, all disposable
  scripts removed. GST intra/inter-state branch (CGST/SGST vs IGST) was
  verified by code review rather than live execution, specifically to avoid
  spending real invoice number 681 on test data — the first real invocation
  of that branch will be an actual owner-created invoice.

**NOT yet done — next session, in this order (see plan file for full detail):**
1. **`npm run build`** (production build) — skipped tonight since the dev
   server was actively running and building alongside it risked `.next`
   conflicts; do this standalone with the dev server stopped first.
2. Repoint the invoice detail page's "Download PDF" button
   (`/dashboard/invoices/[id]/page.tsx`) and the invoices list's button at the
   new `GET /api/invoices/[id]/pdf` route instead of the old client-side
   `lib/generateInvoicePDF.ts` (which still has the wrong hardcoded identity).
   Once nothing calls it, delete `lib/generateInvoicePDF.ts`.
3. Settings → Business Profiles UI (`components/BusinessProfileManager.tsx` +
   `app/api/business-profiles/**`, owner-only CRUD) so the owner can fill in
   Techtenth/Cash logo/signature/stamp/bank/address/GSTIN and upload
   Digitalbluez's logo/signature/stamp (currently NULL — the PDF renders fine
   without them, just no images yet).
4. GSTIN auto-fill: wire the existing (currently unused-by-any-form)
   `app/api/gst/route.ts` into `AddCustomerDialog`/`EditCustomerDialog`/
   `QuickAddCustomerDialog` to fill customer name/address/state/state_code.
   Harden that route first (currently has NO auth check — any caller can hit
   it — and no caching). Provider is swappable; owner's friend uses an
   unnamed GSTIN lookup service (possibly AppyFlow/Sandbox/Masters India) —
   ask for exact provider+key when available, otherwise keep the existing
   Apify-based implementation.
5. Add an entity picker to `components/InvoiceForm.tsx` (currently hardcoded
   to Digitalbluez's state code) once Business Profiles UI exists.
6. Once all of the above is done and re-verified, report Phase 1 fully
   complete to the owner.

Full plan (sections A-H, phases 1-5, permission model, migration safety):
`~/.claude/plans/stateless-shimmying-pearl.md`. Memory:
`db_erp_invoicing_redesign` in the auto-memory system has the confirmed
business decisions (ERP replaces Zoho, entity model, no e-invoicing needed,
etc.) if context is lost.

---

Prior update, 2026-07-22 (later same session: added backdating support to Stock
Intake and Sell, on top of the pre-GST/post-GST toggle and per-employee
page-access permission system added earlier in the day).

Prior update same day: committed the previously-uncommitted
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

**Pre-GST/post-GST toggle on Sell** (`app/dashboard/entry/sell/page.tsx`)
- Employee can specify whether the entered Selling Price is pre-GST or GST-inclusive; switching modes auto-converts the number in the box to keep the customer's total unchanged. Frontend-only — `sale_base_price` sent to `POST /api/sales-entry` is always resolved to the pre-GST amount, so no API/schema changes were needed.

**Per-employee page access + self-service user creation** (replaces manual/Supabase-admin-only account creation)
- New `profiles.allowed_pages text[]` column (CHECK-constrained to 8 keys: `new_entry`, `accessories`, `repair_jobs`, `sku_master`, `live_stock`, `invoices`, `customers`, `activities`) — only meaningful for `role='employee'`; owners always have full access regardless.
- `lib/auth/session.ts`/`lib/auth/useRole.ts`: new `hasPageAccess(sessionUser, key | key[])` helper alongside `isOwner()`.
- `components/sidebar.tsx`: nav items gained an optional `pageKey`, filtered the same way `ownerOnly` already was.
- New `components/RequirePageAccess.tsx` (mirrors `RequireOwner.tsx`) wraps the default export of every page under the 8 areas.
- Added matching `hasPageAccess` checks to each area's primary API route (`stock-intake`, `sales-entry`, `accessories`, `sku-master`, `stock`, `repair-jobs`, `activities`/`activities/[id]`). **Known limitation**: Customers and Invoices pages call Supabase directly client-side (RLS-based, no API route at all) — a pre-existing architectural difference from the rest of the app, not introduced by this feature; enforcement for those two is page-level only (`RequirePageAccess` + nav-hiding), not API-level. A handful of already-role-blind shared utility routes (`reassign-sku`, `qc`, `mark-ready`, `accessory-movements`, `storage/*`, `tags`) were also left ungated for the same "shared across features, no financial-data exposure" reasoning already used elsewhere in this codebase.
- New owner-only `GET`/`POST /api/users` and `PATCH /api/users/[id]` (create user + profile row via `supabaseAdmin.auth.admin`, list all users, update role/allowed_pages/is_active/password). No `DELETE` — deactivation (`is_active=false`) is the only revoke action, since it already fully blocks login and a hard delete would orphan `sales.entered_by`/`sold_by`-style references.
- New `components/UserManager.tsx` (Create User form + existing-users list with Edit Access / Deactivate / Set New Password), following `DropdownOptionsManager.tsx`'s self-contained-section pattern.
- **Settings page redesigned** into a simple category layout (left category list, right content pane) — Asset Numbering / Dropdown Options / Users & Access — replacing the old single long-scroll page.
- Verified end-to-end via a disposable script (real HTTP calls against the running dev server, real Supabase auth users signed in as both a test owner and a test employee, cleaned up and re-verified after): user creation, bogus page-key filtering, page-access enforcement (both an allowed and a blocked route), and deactivation all behave correctly.

**Backdating support for Stock Intake and Sell**
- Both `received_at` (`asset_ledger`, via Stock Intake's new "Date Received" field) and `sale_date`/`sold_at` (via Sell's new "Sale Date" field) were previously hardcoded to "now" in `lib/stock-intake.ts` and `app/api/sales-entry/route.ts` respectively — no way to log a transaction that actually happened earlier. Both now accept an optional date (max = today, defaults to today if left alone); backdated values use noon UTC to avoid a midnight-UTC day shift across timezones.
- **Bug fixed in the same pass**: `POST /api/sales-entry` never populated `sales.sale_month`/`sale_year` at all (always `NULL`) — `app/dashboard/reports/reports-client.tsx` filters strictly by these raw columns, so every sale made through the new Sell flow was already invisible in Reports' year/month filters, backdating or not. Now derived from `sale_date` (same `MONTHS` array/derivation the legacy `app/dashboard/sales/sales-client.tsx` already used) and stored alongside it.
- Verified end-to-end via a disposable script: backdated Stock Intake → backdated Sell of that same unit, confirming `received_at`, `sale_date`, `sale_month`, `sale_year`, and `sold_at` all land correctly; cleaned up and re-verified after.
- **"Date Purchased" added then revoked same session**: a separate `asset_ledger.purchase_date` column/field was briefly added, then removed at the owner's request after confirming "Date Received" alone already covers the need (the owner's initial confusion was from checking production, which didn't yet have this session's changes). Column dropped via migration (backed up first); "Date Received" moved to the top of the Stock Intake form as the single, prominent date field.
- **Date field added to Service (Repair/Replacement/Return)** (`app/dashboard/entry/service/page.tsx`): a single "Date" (Repair/Replacement) / "Return Date" field, backdatable, max=today. New `repair_jobs.job_date` column (date, nullable) for Repair/Replacement — also used to backdate the replacement unit's `asset_ledger.sold_at` when the job type is `replacement`. Return reuses the existing `asset_rma_events.opened_at` column (previously always DB-default "now"), now overridable via a new `event_date` field on `POST /api/rma`. Verified end-to-end via a disposable script covering all three subtypes (Repair, Replacement, Return), confirming `job_date`, `sold_at`, and `opened_at` all land correctly; cleaned up and re-verified after.

## Currently being worked on
Nothing mid-flight. All changes from the bug-fix/upgrade-tracking pass have been committed (commit `957e3a3`), type-checked, and production-build-verified. Dead-table cleanup migration has been applied successfully. The GST-toggle, user-permissions, and backdating work above is type-checked and verified but **not yet committed**.

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
