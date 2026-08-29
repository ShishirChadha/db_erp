---
slug: return-to-vendor-rma
title: Returning a faulty unit to the vendor (RMA)
kind: process
audience: [owner]
routes: [/dashboard/rma]
keywords: [rma, vendor return, faulty, defective, return to vendor, vendor replace]
sources:
  - apps/erp/app/api/rma/route.ts
  - apps/erp/app/api/rma/[id]/route.ts
updated: 2026-08-29
---

## What this is

Sending a unit back to the vendor it was purchased from — for a refund, a
replacement, or credit. Owner-only. Distinct from a customer-facing repair or
replacement job (**repairs-replacements-rma**), which never touches the
vendor.

## Steps

1. Open **RMA (Vendor Returns)**.
2. Select the faulty unit (must be traceable to a vendor via its PO/purchase
   record).
3. Record the RMA event (`asset_rma_events`) — reason, date sent, expected
   resolution.
4. Update once resolved (vendor refund/replacement received).

## Related

**repairs-replacements-rma**, **purchasing**, **customers-vendors**.
