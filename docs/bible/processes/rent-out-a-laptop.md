---
slug: rent-out-a-laptop
title: Rent out a laptop
kind: process
module: rentals
audience: [owner, manager, employee]
routes: ['/dashboard/rentals']
keywords: [rent out, rent karna, kiraye pe dena, give on rent, new rental, rental agreement, security deposit lena, laptop rent pe dena]
sources:
  - apps/erp/app/api/rentals/route.ts
  - apps/erp/components/NewRentalDialog.tsx
  - apps/erp/lib/rentals.ts
updated: 2026-09-16
---

## What this is

Handing one or more units to a customer on rent and opening the agreement that tracks
them. The units leave sellable stock the moment you save — there is no approval step.

## Steps

1. Go to **Operations → Rentals** and click **+ New Rental**.
2. Pick the customer. Use **+ Add Customer** first if they are new.
3. Search sellable stock and tick every unit going out. Only units that have cleared
   QC appear here.
4. Set the **start date** and, if there is one, the **expected return date**. Leave the
   return date blank for an open-ended rental — overdue tracking simply stays off.
5. Choose the **billing interval** (monthly, quarterly, or one-time for the whole
   period) and the **rent amount** for that interval, before GST.
6. Choose **received into** (Digitalbluez / Techtenth / Cash). This decides whether GST
   applies — the GST field only appears for a GST-registered entity.
7. Enter the **security deposit** if you took one, and tick "deposit received".
8. Save. The agreement gets a number like `RNT-26-001` and each unit flips to
   **On Rent**.

## What happens to stock

Each unit moves to `on_rent` and comes out of stock immediately, so it disappears from
the Sell screen and from the website. It still shows on Stock / Live Stock under the
**On Rent** filter.

## Who can do this

Anyone with edit access to the Rentals page — this is operational work, not owner-only.
Employees never see cost, vendor or margin on any rental screen.

## Common mix-ups

- **The deposit is not income.** It is money you are holding and will give back, so it
  never appears in revenue or on a GST invoice. Only a portion you later *withhold*
  becomes income — see **settle-a-rental-deposit**.
- **Rent is entered pre-GST.** The GST is added on top when the charge is raised.
- **A unit already out on rent cannot be rented again.** The system refuses it; return
  it first.
- **Opening the agreement does not bill anything.** The first rent charge is raised
  separately — see **bill-a-rental-cycle**.

## Related

**rentals** (the module overview), **bill-a-rental-cycle** (raising the rent charge),
**return-a-rented-laptop** (taking it back), **sell-a-unit** (an ordinary sale, for
contrast), **qc-a-unit** (what a returned unit goes back through).
