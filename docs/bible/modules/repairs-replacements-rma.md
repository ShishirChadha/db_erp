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
  - apps/erp/app/api/accessory-rma/**
  - apps/erp/app/api/accessory-replacement-jobs/**
updated: 2026-09-16
---

## What this covers

Three related but distinct flows — each with a serialized-unit version and an
accessory (quantity-only, no `asset_ledger` row) version:

- **Repair Jobs** — a customer's unit comes in for service. Status and (as of
  2026-08-04) payment fields are gated by the page's own edit grant, not
  owner-only. Marking a job "Done" creates a linked `sales` row
  (`sales.repair_job_id`), so the repair charge lands in the normal Sales
  Ledger and can be invoiced through the same multi-item flow as any other
  sale — see **open-a-repair-job**. No dedicated accessory table needed here:
  a customer's own accessory is just free text (`customer_device_description`),
  same as a customer-owned laptop that isn't our stock.
- **Replacement Jobs** — swapping a customer's unit for another. The given-out
  unit is marked `sold` immediately, same "immediately real" principle as any
  other sale. `accessory_replacement_jobs` (2026-09-16) is the accessory
  counterpart — `old_sku_id`/`replacement_sku_id` + quantities in place of
  `asset_id`/`replacement_asset_id`, same `RPL-YY-###` numbering sequence,
  `/dashboard/replacement-jobs` has a Units/Accessories tab to browse both —
  see **open-a-replacement-job**.
- **RMA (Vendor/Customer Returns)** — `asset_rma_events` for serialized units;
  `accessory_rma_events` (2026-09-09) is the accessory counterpart, same
  `direction` (`to_vendor`/`from_customer`) vocabulary, `/dashboard/rma` has a
  Units/Accessories tab. Vendor returns stay owner-only in both. Unlike a
  serialized unit (tracked via `asset_ledger.status`), an accessory return
  moves `stock_movements`/`quantity_in_stock` **immediately** on open — there's
  no per-unit QC-pending status to hold a returned accessory in limbo — see
  **return-to-vendor-rma**.

## Related

**business-rules** (immediately-real entries), **sales-invoicing** (the
repair→sale link), **live-stock-qc** (unit status transitions),
**inventory-sku** (accessories as fungible `sku_master` rows).
