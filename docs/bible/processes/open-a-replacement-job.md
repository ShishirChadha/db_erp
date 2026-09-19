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
updated: 2026-09-19
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
opens the job types the actual `amount_charged` for the new unit, same as a
normal sale. Whatever the customer already paid on the old sale carries over
automatically (see below); the only thing staff enters manually is any
top-up or refund adjustment.

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
     `sale_payments` entry on the new one, plus any top-up entered at intake;
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
  to whatever `amount_charged` is typed in at step 4. If that field is left
  at 0 (e.g. staff forgot it, or it was meant as a placeholder to fill in
  later), the carried-over payment is clamped to 0 too — the job silently
  looks like a free/unpaid swap even though money was already collected on
  the original sale. There is no warning for this; the form doesn't display
  or prefill the old sale's amount as a reference. Fix: check the *old*
  unit's sale (Sales Ledger, by its asset/serial number, before the return)
  for what was actually paid, then correct the *new* sale's price via the
  owner-only Sales Ledger edit so the figures — and the carried-over
  payment — are right.
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
