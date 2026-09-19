---
slug: open-a-repair-job
title: Opening and closing a repair job
kind: process
audience: [owner, manager, employee]
module: repairs-replacements-rma
routes: [/dashboard/repair-jobs]
keywords: [repair job, service, repair karna, fix, job number, RJ, mark done, repair charge]
sources:
  - apps/erp/app/api/repair-jobs/route.ts
  - apps/erp/app/api/repair-jobs/[id]/finalize/route.ts
  - apps/erp/app/api/repair-jobs/[id]/parts/route.ts
  - apps/erp/lib/repair-jobs.ts
updated: 2026-09-19
---

## What this is

Tracking a customer's unit that came in for service, from intake through
completion and billing.

## Steps

1. Open **Repair Jobs**, create a new job — customer, unit/serial (if it's an
   existing asset), problem description.
2. The job number is minted via `generate_repair_job_number()` — never a
   manual counter.
3. As work happens, update `status` and, once known,
   `payment_status`/`amount_paid`/`payment_account`. These fields are gated by
   whoever has the `repair_jobs` page's edit grant — not owner-exclusive.
4. Mark the job **Done**. This creates a linked `sales` row
   (`sales.repair_job_id`) for the repair charge — it now shows up in the
   normal Sales Ledger and can be combined into a GST invoice through the
   same multi-item flow as any other sale (see **raise-a-gst-invoice**).

## Repairing our own not-yet-sold stock (e.g. a QC-failed unit) — no customer needed (2026-09-19)

A repair job isn't only for a customer's device — it's also the way to pull an
accessory part (RAM, keyboard, battery, etc.) onto one of our **own** units
that failed QC or otherwise needs fixing before it can be sold. For that
case, **Customer is optional**: pick "This is our own stock," select the
unit, and leave Customer blank — the form only allows this when the unit
hasn't been sold yet (checked against its real status server-side, not just
what the form shows). A repair on a unit that's already been sold to someone
still requires a real customer, unchanged, since that's a warranty/goodwill
job for a real buyer.

What's different for this customer-less case:
- A part consumed becomes a plain stock adjustment, not a priced sale — there's
  no one to bill, so `"Received Into"` isn't required either.
- Marking the job **Done** does **not** create a sales-ledger charge (nothing
  was charged) — instead, the unit is **automatically sent back to QC**
  (`qc_pending`) so it goes through re-inspection before it can be marked
  sellable again. You don't need a separate trip to the Stock page for this.
- A part can also be added mid-job via the same route parts added at intake
  use (`POST /api/repair-jobs/[id]/parts`) — same "no payment_account needed"
  rule applies when the job has no customer.

## Related

**repairs-replacements-rma**, **sales-invoicing**, **business-rules**
(numbering rule).
