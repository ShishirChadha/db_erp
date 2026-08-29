---
slug: repairs-replacements-rma
title: Repairs, Replacements & RMA
kind: module
audience: [owner, manager, employee]
routes: [/dashboard/repair-jobs, /dashboard/replacement-jobs, /dashboard/rma]
keywords: [repair, replacement, rma, return, warranty claim, service job, vendor return, job number]
sources:
  - apps/erp/app/api/repair-jobs/**
  - apps/erp/app/api/replacement-jobs/**
  - apps/erp/app/api/rma/**
updated: 2026-08-29
---

## What this covers

Three related but distinct flows:

- **Repair Jobs** — a customer's unit comes in for service. Status and (as of
  2026-08-04) payment fields are gated by the page's own edit grant, not
  owner-only. Marking a job "Done" creates a linked `sales` row
  (`sales.repair_job_id`), so the repair charge lands in the normal Sales
  Ledger and can be invoiced through the same multi-item flow as any other
  sale — see **open-a-repair-job**.
- **Replacement Jobs** — swapping a customer's unit for another. The given-out
  unit is marked `sold` immediately, same "immediately real" principle as any
  other sale.
- **RMA (Vendor Returns)** — sending a faulty unit back to the vendor.
  Owner-only. Distinct from a customer-facing repair/replacement.

## Related

**business-rules** (immediately-real entries), **sales-invoicing** (the
repair→sale link), **live-stock-qc** (unit status transitions).
