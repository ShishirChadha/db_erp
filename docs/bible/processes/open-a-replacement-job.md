---
slug: open-a-replacement-job
title: Replacing a customer's unit with another one
kind: process
module: repairs-replacements-rma
audience: [owner, manager, employee]
routes: [/dashboard/replacement-jobs]
keywords: [replacement, replace, swap, exchange, badalna, upgrade, downgrade, different spec, already has po, po already raised, asset number, replacement job, RJ number, accessory, accessories, accessory replacement, charger, cable, mouse, keyboard, item type toggle]
sources:
  - apps/erp/app/api/replacement-jobs/route.ts
  - apps/erp/app/api/replacement-jobs/[id]/route.ts
  - apps/erp/app/api/replacement-jobs/[id]/finalize/route.ts
  - apps/erp/lib/replacement-jobs.ts
  - apps/erp/lib/rma.ts
  - apps/erp/app/dashboard/replacement-jobs/page.tsx
  - apps/erp/app/api/accessory-replacement-jobs/route.ts
  - apps/erp/app/api/accessory-replacement-jobs/[id]/finalize/route.ts
  - apps/erp/lib/accessory-replacement-jobs.ts
  - apps/erp/lib/accessory-rma.ts
  - apps/erp/app/dashboard/entry/service/page.tsx
updated: 2026-09-29
---

## What this is

Swapping a unit a customer already has (ours or theirs) for a different unit
from our stock — not a repair (the unit itself is being replaced, not fixed)
and not a plain customer return (a new sale happens in the same step). From
**Replacement Jobs** (`/dashboard/replacement-jobs`), or deep-linked from the
Service form.

## Who can do this

Creating a job needs **New Entry** page access — any signed-in staff member
who can sell a unit can open a replacement job; there's no owner-approval
gate on creating one. Viewing the list needs **Replacement Jobs** page access.
Editing `status`/`problem_description` needs the edit grant on that page.
Editing `amount_charged`/`payment_account`, and finalizing a job (marking it
`done`), are **owner-only**.

## Does it matter if the old unit already has a PO / asset number?

**No.** A replacement job works entirely off `asset_ledger` rows by their
serial number and status — the same "operational flows never require an
asset number" rule as selling or QC'ing a unit (see **business-rules**).
Whether the unit going out already has a real Purchase Order attached, or was
sold before ever getting one, makes no difference here: the swap logic never
reads `asset_number` or checks PO state at all.

## Can the replacement be a different spec (upgrade or downgrade)?

**Yes, and nothing here restricts or auto-detects it.** The replacement unit
just has to be any currently sellable unit in stock (`SELLABLE_STATUSES`) —
it doesn't have to share the original unit's SKU, spec, or price. If it's a
different spec, the price difference isn't calculated automatically: whoever
opens the job types the actual `amount_charged` for the new unit (the new
unit's **full** pre-GST price, not the delta), same as a normal sale.
Whatever the customer already paid on the old sale carries over
automatically (see below); the only thing staff enters manually is any
`additional_amount_paid` top-up.

**Validation (2026-09-29):** `amount_charged` must be a valid, non-negative
number (blank/negative rejected; **0 is allowed**, for a genuinely free/
warranty replacement — matches the same zero-is-allowed rule as a normal
sale, see **business-rules**) and `additional_amount_paid` can't be
negative — both checked client-side (`entry/service/page.tsx`) and
server-side (`replacement-jobs/route.ts` / `accessory-replacement-jobs/
route.ts`), since only the server check is a real guarantee. If
`carried-over paid + top-up` would exceed the new sale's total, the request
is rejected (`409`, `error_code: 'exceeds_sale_total'`) unless the caller
confirms with `confirm_overpayment: true` — the client shows a
`confirm(...)` dialog and retries automatically, same pattern as `POST
/api/sales/[id]/payments`. Once confirmed, the **true, uncapped** amount is
recorded (no silent clamping), which is what makes an overpaid replacement
naturally show up under Pending Tasks → **Customers Owed Money**
(`GET /api/sales?credit_owed=true`) alongside voided sales that still show
a paid amount (see **Common mix-ups** below for the incidents that drove
this).

## Steps

1. Open **Replacement Jobs** and start a new one (or use the "Replace" action
   from an existing Repair/Service record).
2. Pick the customer, and whether the unit coming back is **our own stock**
   (an `asset_ledger` row we sold them — pick it by serial/asset number) or a
   **customer-owned device** (just describe it — nothing to reverse in our
   inventory for that side).
3. Pick the **replacement unit** from current stock — any sellable unit,
   regardless of spec versus the original.
4. Enter the sale details for the replacement: price, GST/Cash sale type,
   payment account, sold-by, any bundled accessories, any parts consumed
   from stock (e.g. a cable used during the swap).
5. Submit. In one step this:
   - if the old unit was our own stock, reverses its sale (inventory and any
     of its own bundled accessories) and sends it back to **QC pending** —
     the same path a plain customer Return uses;
   - creates a **real sale** for the replacement unit, exactly like the Sell
     form would, so it shows correctly in Sold Stock, Reports, and everywhere
     else a sale appears;
   - carries over whatever was already paid on the old sale as the first
     `sale_payments` entry on the new one, plus any top-up entered at intake
     — backdated to when that money was actually received when it's a pure
     carry-over with no top-up (a carry-over mixed with a top-up stays dated
     today, since one row can't hold two dates and part of it genuinely is
     new money) (2026-09-29);
   - stamps the new sale's `original_sold_date` with the earliest date in
     the replacement chain (the old unit's own `sale_date`, or its
     `original_sold_date` if it was itself a prior replacement) — purely a
     display field; `sale_date` itself always stays the real transaction
     date (today) so revenue/GST period reporting is never affected
     (2026-09-29, see "Common mix-ups" below for why);
   - consumes any parts used, linked back to the job.
6. The job stays open until the owner marks it **Done** (`/finalize`), which
   only closes the job record — the inventory and sale effects already
   happened at step 5, not at finalize time.

## What about an accessory (charger, cable, mouse, etc.)?

**Same idea, separate table (`accessory_replacement_jobs`), same page.** Accessories are
fungible `sku_master` rows with no per-unit `asset_ledger` row (see **inventory-sku**), so
they can't slot into `replacement_jobs` — pick **Accessories** on the Item Type toggle when
opening a job (also available on `/dashboard/replacement-jobs`' Units/Accessories tab, and
via `?item_kind=accessory` on the deep link). Everything else works the same way:

- "Our own stock" vs. "customer-owned item" is still the same checkbox — for an accessory
  it picks between searching a SKU + quantity (the item physically coming back) or a plain
  description (nothing to reverse in our inventory).
- The replacement item is picked as a SKU + quantity instead of a serialized unit.
- Submitting does the same two things in one step: the old item (if ours) goes back into
  stock immediately via the same mechanism a plain accessory Return uses (**return-to-vendor-rma**
  covers the general RMA shape); the new item becomes a real standalone accessory sale, the
  same "standalone accessory line" the Sell cart already knows how to write.
- **One real difference**: a fungible item has no per-unit sale history to trace back to, so
  there's no "already paid, carries over automatically" — `amount_charged` and any top-up
  are always a fresh manual entry, even when the old item is one of ours.
- "Bundled Accessories" (an accessory bundled onto the new *unit's* sale) doesn't apply here
  and isn't shown — bundling an accessory onto another accessory's sale isn't a supported
  shape.
- Job numbering is shared with unit replacement jobs (`RPL-YY-###`) — it's one business
  record type regardless of what's being swapped.

## Common mix-ups

- **"Why didn't the price difference get calculated automatically?"** —
  it isn't; `amount_charged` on the replacement sale is always a manual
  entry, same as any other sale.
- **"The old unit isn't showing back up in stock yet."** — a customer-return
  unit re-enters as `qc_pending`, not straight back to sellable — it needs to
  go through QC again first (see **qc-a-unit**) before it can be sold again.
- **Payment corrections** after the job is created go through the linked
  `sales` row's own payment ledger (Sales Ledger → Add Payment / owner-only
  correction), not through the replacement job record itself — there's no
  `amount_paid` field on `replacement_jobs` to edit.
- **"The customer already paid for the original unit — why does the
  replacement show as unpaid / free?"** (real incident, 2026-09,
  `DBAS26-196`/`RPL-26-004`) — the already-paid amount only carries over up
  to whatever `amount_charged` is typed in at step 4. Before the 2026-09-29
  validation, leaving that field at 0 (e.g. staff forgot it, or it was meant
  as a placeholder) silently clamped the carried-over payment to 0 too — the
  job looked like a free/unpaid swap even though money was already
  collected, with no warning either way. **As of 2026-09-29, `amount_charged
  = 0` is still allowed** (a genuinely free/warranty replacement is a real
  case), **but if the old sale had money on it, `carriedOverPaid > 0` against
  a `saleTotal` of 0 now trips the overpayment guard** — the confirm dialog
  ("carried-over ₹X + top-up ₹0, above the new sale's total of ₹0") makes
  the mismatch visible instead of silently discarding it. Confirming records
  the true amount, which then surfaces under Pending Tasks → **Customers
  Owed Money**. The form still doesn't prefill the old sale's amount as a
  reference, so a *wrong but positive* `amount_charged` (rather than 0) can
  still slip through unnoticed if it happens not to trigger the guard. Fix
  if it does happen: check the *old* unit's sale (Sales Ledger, by its
  asset/serial number, before the return) for what was actually paid, then
  correct the *new* sale's price via the owner-only Sales Ledger edit so the
  figures — and the carried-over payment — are right.
- **"I corrected the sale price afterward and the Replacement Jobs list
  still shows the old amount."** (real incident, 2026-09, `DBAS26-258`/
  `RPL-26-007`) — `replacement_jobs.amount_charged` is only a snapshot
  written once at job creation (step 5); there is no live FK from a sale
  back to its replacement job, so a later correction made directly on the
  `sales` row (e.g. voiding an incorrect ₹0 entry and re-entering the real
  price) doesn't automatically update it. `GET /api/replacement-jobs`
  (2026-09-19) now overrides the displayed `amount_charged` with the
  linked unit's current, non-voided sale total when one exists, so the list
  self-corrects — but the underlying `replacement_jobs.amount_charged`
  column itself stays stale unless also edited directly (owner-only, via
  this record's own PATCH).
- **"Why does the Sales Ledger/Sold Stock show the replacement date as the
  sold date instead of when the customer originally bought it?"** (real
  incident, 2026-09-29, `RPL-26-009`) — because the old unit's sale is
  voided (see the `DBAS26-258` mix-up above) it's hidden from every list, so
  only the brand-new sale on the replacement unit shows, correctly dated
  today (that IS the true transaction date for that physical unit; changing
  `sale_date` to an earlier date would retroactively move revenue into an
  already-closed period). `sales.original_sold_date` (2026-09-29) is the
  fix: a display-only column, stamped with the earliest `sale_date` in the
  replacement chain, that Sales Ledger and Stock/Sold both show as the
  primary "sold" date (with the actual `sale_date` shown alongside as
  "Replaced X") whenever it's set — `sale_date` itself is never touched.
  Only sales created via a replacement job from 2026-09-29 onward have it;
  older replacement sales show just their own `sale_date`, same as before.
- **A carried-over payment can go stale if the sale's price is edited
  afterward.** (real incident, 2026-09-29, same `RPL-26-009`) — splitting a
  bundled item's price out into its own separate sale (e.g. pulling a
  camera/accessory that was priced into the unit's total out into its own
  standalone accessory sale) doesn't automatically reduce the unit sale's
  already-recorded carried-over payment to match the new, lower price — the
  unit sale is left showing `amount_paid` greater than its own `sale_total`
  (an invisible overpayment, still displayed as plain "paid"), and if the
  split-out item also gets a brand-new payment recorded against it, that
  same money is effectively double-counted across two sales. There's still
  no validation that catches this specific case (editing a sale's price
  after the fact, via Sales Ledger → Edit Sale, doesn't re-check its
  existing payments against the new total) — the 2026-09-29 validation only
  guards the *replacement job's own* carried-over + top-up math at creation
  time, not a later manual price edit. Fix: after splitting a price like
  this, always re-check the original (unit) sale's payment against its new,
  lower total and correct it (delete + re-add via Sales Ledger → Edit Sale →
  Payments, backdated to when the money was actually received) rather than
  leaving the stale higher amount in place. An overpaid sale like this would
  now at least surface under Pending Tasks → **Customers Owed Money** once
  `amount_paid > sale_total` on it, even though nothing blocked the edit
  that caused it.
- **"I got a popup asking to confirm the payment before the job would
  save."** (expected, 2026-09-29) — if carried-over paid + top-up would
  exceed the new unit's total, submitting is blocked with a confirm dialog
  instead of silently accepting it. This is almost always a sign the
  top-up amount (or the new unit's `amount_charged`) was typed wrong —
  double-check both before confirming. If it's genuinely correct (e.g. the
  customer is deliberately leaving a credit for a future purchase),
  confirming proceeds and records the true amount — which then shows up
  under Pending Tasks → **Customers Owed Money** as a reminder.
