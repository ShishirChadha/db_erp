---
slug: bill-a-rental-cycle
title: Bill a rental cycle
kind: process
module: rentals
audience: [owner, manager, employee]
routes: ['/dashboard/rentals/[id]']
keywords: [rent charge, bill rent, rent bill banana, kiraya lena, monthly rent invoice, rental invoice, rent payment, raise rent]
sources:
  - apps/erp/app/api/rentals/[id]/charges/route.ts
  - apps/erp/lib/rentals.ts
updated: 2026-09-16
---

## What this is

Turning one billing period's rent into a real charge the customer owes. The charge
becomes an ordinary sale, so it shows in the Sales Ledger and can be invoiced and paid
exactly like any other sale.

## Steps

1. You will normally arrive from the reminder — a task appears under **Activity Hub**
   and on **Pending Tasks → Rent Due to Bill** a few days before each cycle is due.
2. Open the agreement from **Operations → Rentals**.
3. Click **Generate rent charge**. The period and amount are filled in from the
   agreement; GST is added if the entity is GST-registered.
4. The charge appears under **Billing** on the same page and in the Sales Ledger.
5. Record money as it comes in with **Payment** on that line. Part payments are fine —
   the status moves pending → partial → paid on its own.
6. When you want the GST invoice, use **Invoice** on the line (owner only), or combine
   it with the customer's other sales into one invoice from the Sales Ledger.

## What gets charged

Only the units still out are billed. If a customer took three laptops and gave one
back, the next cycle is charged for two, not three.

## Who can do this

Raising the charge and recording payments: anyone with edit access to Rentals.
Generating the GST invoice: owner only, same as every other invoice.

## Common mix-ups

- **The reminder does not bill anything by itself.** It raises a task; a person still
  presses the button. Money is never created by a background job here.
- **The same period cannot be billed twice** — the system refuses it, so an accidental
  double-click or a re-raised task is safe.
- **Rent is tracked separately from unit sales in reports**, so it will not inflate your
  laptop sales figures, and a laptop's purchase cost is never counted against one
  month's rent.
- **A one-time agreement bills once.** It has no next cycle and raises no further
  reminders.

## Related

**rentals** (the module overview), **rent-out-a-laptop** (opening the agreement),
**record-a-part-payment** (the same payment flow used everywhere),
**raise-a-gst-invoice** (combining sales onto one invoice).
