---
slug: return-a-rented-laptop
title: Return a rented laptop
kind: process
module: rentals
audience: [owner, manager, employee]
routes: ['/dashboard/rentals/[id]']
keywords: [rental return, laptop wapas, return from rent, take back, rent khatam, close rental, buyout, rent to own, kharid liya, deposit refund]
sources:
  - apps/erp/app/api/rentals/[id]/items/[itemId]/return/route.ts
  - apps/erp/app/api/rentals/[id]/items/[itemId]/buyout/route.ts
  - apps/erp/app/api/rentals/[id]/close/route.ts
  - apps/erp/app/api/rentals/[id]/deposit/route.ts
updated: 2026-09-16
---

## What this is

Closing out a rental: taking units back, or selling one to the renter who wants to keep
it, then settling the deposit and closing the agreement.

## Steps — the customer returns the unit

1. Open the agreement from **Operations → Rentals**.
2. On the unit's row under **Units**, click **Return**.
3. Note the condition it came back in.
4. Save. The unit goes back into the **QC queue** — not straight to sellable — so it
   gets re-checked before it is sold or rented again. Stock goes back up by one.

## Steps — the unit was lost or destroyed

1. Click **Return** on that unit and tick **lost or damaged beyond use**.
2. Save. The unit is scrapped. Stock does not change again — it already left when it
   went out.

## Steps — the renter buys the unit (rent-to-own)

1. Click **Buyout** on the unit's row.
2. Enter the agreed price (pre-GST), anything paid now, and which account received it.
3. Save. The unit becomes **Sold**, and a normal sale appears in the Sales Ledger —
   invoice and collect against it like any other sale.

## Steps — settle the deposit and close

1. Once every unit is returned, bought out or written off, an **owner** clicks
   **Settle deposit** and enters how much is going back to the customer.
2. If any part is withheld, give a reason. You will be offered the option to record the
   withheld amount as income — leave it ticked so it is taxed and reported correctly.
3. Click **Close agreement**.

## Who can do this

Returns, write-offs, buyouts and closing: anyone with edit access to Rentals.
Settling the deposit: **owner only**, because it is money going out.

## Common mix-ups

- **A returned unit is not immediately sellable.** It sits in QC first, by design.
- **Rent already billed is not adjusted against a buyout price.** If you mean to give
  credit for rent paid, reduce the buyout price yourself.
- **An agreement cannot be closed with units still out.** Record each unit's return or
  buyout first.
- **A buyout does not double-count stock.** The unit left stock at handover and never
  came back, so the sale does not remove it a second time.
- **The refunded part of a deposit is not an expense** — it was never income. Only the
  withheld part is.

## Related

**rentals** (the module overview), **rent-out-a-laptop** (opening the agreement),
**bill-a-rental-cycle** (the rent charges), **qc-a-unit** (what a returned unit enters),
**sell-a-unit** (an ordinary sale, for contrast).
