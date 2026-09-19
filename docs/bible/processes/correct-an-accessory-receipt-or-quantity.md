---
slug: correct-an-accessory-receipt-or-quantity
title: Correcting an accessory's receipt details or stock quantity
kind: process
audience: [owner, manager, employee]
module: accessories
routes: ['/dashboard/accessories/[id]']
keywords: [correct accessory, fix quantity, galat entry thik karna, edit receipt, wrong vendor, wrong price, stock count galat, recount, quantity adjustment, correct quantity]
sources:
  - apps/erp/app/dashboard/accessories/[id]/page.tsx
  - apps/erp/app/api/stock-movements/[id]/route.ts
  - apps/erp/lib/accessory-movements.ts
  - apps/erp/app/api/purchase-orders/from-accessory-stock/route.ts
  - apps/erp/app/api/stock/accessories/route.ts
updated: 2026-09-19
---

## What this is

Two genuinely different corrections live on an accessory's history, and it's
easy to reach for the wrong one:

- **Edit Receipt** (`EditReceiptDialog`, on the accessory's detail page,
  `/dashboard/accessories/[id]`) — fixes the *details* of a past receipt
  row: which vendor it was from, the total price paid, GST%, the purchase
  date, payment account, or notes. It never changes the quantity.
- **Correct Quantity** (`AdjustQuantityControl`, on the Accessories list
  page) — records a brand-new `adjustment` movement that changes how much
  stock exists (e.g. a recount found 2 fewer than the system shows). It
  never touches vendor/price/date on any existing row.

## Why they're different mechanisms, not two ways to do the same thing

`sku_master.quantity_in_stock` is trigger-maintained
(`trg_sync_sku_stock`) off `stock_movements` **inserts only** — the trigger
never fires on an `UPDATE`. That means a past receipt's `quantity_change`
can never be safely edited in place: doing so would silently desync
`quantity_in_stock` from the ledger and corrupt every later movement's
`quantity_before`/`quantity_after` running total for that SKU. So:

- `PATCH /api/stock-movements/[id]` (what Edit Receipt calls) deliberately
  **does not accept `quantity_change` or `movement_type`** — only
  `notes`, and — for `receipt` rows specifically — `vendor_id`, `unit_price`,
  `gst_percentage`, `purchase_date`, `payment_account`. Submitting any of
  those five on a non-`receipt` row is rejected (`400`).
- A real quantity correction always goes through a **new** `adjustment`
  movement instead (`POST /api/sku-master/[id]/stock-movement` with
  `movement_type: 'adjustment'`) — a fresh, auditable ledger entry, never a
  rewrite of history.

## Who can do this

- **Edit Receipt / editing a note**: any signed-in staff member with access
  to the `accessories`, `new_entry`, or `sku_master` page —
  `hasPageAccess(sessionUser, ['accessories', 'new_entry', 'sku_master'])`.
  Not owner-only, matching this app's general rule that an accessory's
  purchase-entry vendor/price is visible and editable by every role.
- **Correct Quantity**: the Accessories page only renders the "Correct
  Quantity" button when `isOwner` is true — but note that server-side, `POST
  /api/sku-master/[id]/stock-movement` accepts an `adjustment` movement
  under the exact same page-access check as a `receipt` (any of
  `accessories`/`new_entry`/`sku_master`), **not** an owner check. The
  owner-only restriction on quantity corrections is currently enforced only
  by the UI hiding the button, not by the API itself.

## Steps — Edit Receipt

1. Open the accessory's detail page (`/dashboard/accessories/[id]`) and find
   the `receipt` row in the Movement Ledger — only `receipt` rows show an
   **Edit** action; `sale`/`adjustment` rows don't.
2. Click **Edit**, adjust vendor, total price paid (entered as the whole
   receipt's total, same as at entry time — the dialog divides by quantity
   to store `unit_price`), GST%, purchase date, payment account, or notes.
3. Save. This never changes the quantity or the `quantity_before`/
   `quantity_after` values already recorded for that row or any row after it.

Any movement's **Notes** field (receipt, sale, or adjustment) can also be
edited inline, separately, just by clicking on it in the Notes column — it's
meant as a quick, come-back-later remark, not tied to the receipt-only
fields above.

## Steps — Correct Quantity

1. On the **Accessories** list page, find the SKU's row and click **Correct
   Quantity**.
2. Enter a signed delta (e.g. `-2` to remove two, `5` to add five) and an
   optional reason (defaults to "Quantity correction").
3. Apply. This posts a new `adjustment` `stock_movements` row; `sku_master.
   quantity_in_stock` updates via the sync trigger, same as any other
   movement.

## Effect on the "needs PO" backlog (fixed 2026-09-19)

A Correct Quantity adjustment now correctly shrinks (or grows) the "needs PO"
backlog shown on `/dashboard/accessories` and the Stock page's Accessories
tab — e.g. correcting a receipt of 10 down to 5 (because only 5 actually
arrived) drops "10 received, no PO" to "5 received, no PO". Before this fix,
the backlog only ever counted `receipt` movements, so a correction was
invisible to it — the indicator stayed stuck at the pre-correction number,
and worse, the owner could still attach the stale (too-large) quantity to a
PO, formalizing a purchase for units that were never actually received.
`getUnattachedBacklogBySku`/`claimAccessoryBacklog` (`lib/accessory-movements.ts`)
and the backlog queries in `/api/purchase-orders/from-accessory-stock` and
`/api/stock/accessories` now all net in `adjustment` rows alongside `receipt`
rows (both still `po_id IS NULL` only — an adjustment already tied to a real
PO, e.g. a PO-line correction, is never counted here). This does **not**
apply to sales — selling some of what was received still doesn't shrink the
backlog; only a correction to the received-quantity record itself does (see
`docs/project-context.md`'s Accessories section for the full invariant).

## Common mix-ups

- **"I need to fix a receipt that had the wrong quantity."** — Edit Receipt
  can't do this (quantity isn't editable there by design). Use Correct
  Quantity to add/remove the difference instead, with a note explaining why.
- **"Why is Correct Quantity hidden from me but I found the API accepts
  it?"** — the button is UI-gated to owner, but the underlying endpoint is
  gated by page access like the rest of the accessories movement flow, not
  by role. This is a real UI/server mismatch, not a documentation error.
- **"I can't find Edit on a sale or adjustment row."** — expected; Edit
  Receipt only ever applies to `receipt` movements.
