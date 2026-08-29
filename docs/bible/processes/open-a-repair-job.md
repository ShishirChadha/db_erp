---
slug: open-a-repair-job
title: Opening and closing a repair job
kind: process
audience: [owner, manager, employee]
routes: [/dashboard/repair-jobs]
keywords: [repair job, service, repair karna, fix, job number, RJ, mark done, repair charge]
sources:
  - apps/erp/app/api/repair-jobs/route.ts
  - apps/erp/app/api/repair-jobs/[id]/finalize/route.ts
updated: 2026-08-29
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

## Related

**repairs-replacements-rma**, **sales-invoicing**, **business-rules**
(numbering rule).
