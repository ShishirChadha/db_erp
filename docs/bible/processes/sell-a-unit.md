---
slug: sell-a-unit
title: Selling a unit (in-store)
kind: process
audience: [owner, manager, employee]
module: sales-invoicing
routes: [/dashboard/entry/sell, /dashboard/entry]
keywords: [sell, sale, bech, bechna, sale entry, stock out, customer ko dena, billing, sold, laptop, desktop, monitor, tablet, accessory, device, unit]
sources:
  - apps/erp/app/api/sales-entry/route.ts
  - apps/erp/lib/sales-entry.ts
  - apps/erp/app/dashboard/entry/sell/page.tsx
updated: 2026-10-05
---

## What this is

Recording a walk-in or known-customer sale of one or more units/accessories, from
New Entry → Sell. This is the everyday sale flow — for a repair job's parts charge
or a formal multi-item GST invoice, see their own chapters.

## Who can do this

Any signed-in staff member with access to the **New Entry** page (`new_entry` page
key). There is no owner-approval step — the sale is real, and stock decrements,
the moment it's submitted.

## Steps

1. Open **New Entry → Sell** (`/dashboard/entry/sell`).
2. Search for the item by serial number, asset number, or SKU — laptops/desktops/
   monitors/tablets resolve to a specific `asset_ledger` row; accessories resolve to
   a SKU and a quantity.
3. Pick or quick-add the customer (`SearchableCustomerSelect` / `QuickAddCustomerDialog`).
4. Enter the sale price, payment received so far (full or partial), and the payment
   account (Digitalbluez / Techtenth / Cash — see **entity-model** in
   `finance-gst-reports`).
5. Submit. This immediately:
   - marks the unit `status = 'sold'` (serialized items) or writes a negative
     `stock_movements` row (fungible items, decrementing `sku_master.quantity_in_stock`
     via the sync trigger — never edited directly);
   - creates the `sales` row and, if a partial payment was entered, the first
     `sale_payments` row;
   - does **not** require an invoice number yet — that's separate paperwork (see
     **raise-a-gst-invoice**).

## What happens next

- A partial payment can be topped up later by *any* role from the Sales Ledger's
  "Add Payment" action (`POST /api/sales/[id]/payments`) — this is an append-only
  ledger; `sales.amount_paid`/`payment_status` are trigger-derived, never edited
  directly.
- The owner later attaches this sale to a GST invoice (or a Purchase Invoice-style
  external record) whenever they get to the bookkeeping — `sales.finalized` reflects
  that, it is never a gate on the sale itself.
- Only the owner can void a sale (`/api/sales/[id]/void`) or correct/delete a
  payment entry.

## Common mix-ups

- **"Why can't I see the cost price on this sale?"** — Cost/vendor/margin are
  owner-only everywhere except an accessory's purchase-entry vendor+price (a
  deliberate, narrow exception — see **business-rules**). Selling price is never
  redacted; every role can see and set it.
- **"The unit isn't showing in search."** — Check its status isn't already `sold`,
  `reserved_web`, or QC-failed/scrapped; Live Stock and the main ERP Stock page
  deliberately show non-overlapping sets filtered by `asset_ledger.source`.

## If the period is locked

A sale dated inside a locked period is refused with `period_locked`. A locked
period has normally been filed, so adding a sale to it would change a return
already sent to the portal. Either record it in an open period, or ask the
owner to reopen a window for that date — which is logged with a reason. See
**finance-gst-reports**.

## Marking a sale as never going to be invoiced

A checkbox at entry flags a sale that will never produce a tax invoice -- a
sample, gift, warranty replacement, or demo/internal-use unit. This is not a
way to skip tax for free: a gift or sample still owes nothing in output tax,
but s.17(5)(h) blocks the input credit on it, so the credit originally claimed
on that unit has to be reversed, and the owner reviews every exclusion before
the GST period is filed. See **finance-gst-reports**.
