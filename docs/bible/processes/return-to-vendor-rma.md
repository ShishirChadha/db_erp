---
slug: return-to-vendor-rma
title: Returning a faulty unit to the vendor (RMA)
kind: process
audience: [owner]
module: repairs-replacements-rma
routes: [/dashboard/rma]
keywords: [rma, vendor return, faulty, defective, return to vendor, vendor replace, accessory, accessories, accessory rma, accessory return, accessory_rma_events]
sources:
  - apps/erp/app/api/rma/route.ts
  - apps/erp/app/api/rma/[id]/route.ts
  - apps/erp/app/api/accessory-rma/route.ts
  - apps/erp/app/api/accessory-rma/[id]/route.ts
  - apps/erp/lib/accessory-rma.ts
updated: 2026-09-16
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

## Accessories (2026-09-09)

The same to-vendor / from-customer shape exists for accessories via a
separate table, `accessory_rma_events` — pick the **Accessories** tab on
`/dashboard/rma` (or the Item Type toggle on the Return sub-tab of
`/dashboard/entry/service`) instead of picking a serialized unit. Since a
fungible accessory has no per-unit status (`asset_ledger.status`) to hold it
in while a case is open, the stock effect happens **immediately at open**,
not at resolution:

- **To vendor** (owner-only, same as the unit version): opening the case
  decrements stock right away (the item is physically leaving); resolving as
  "replacement received" increments it back; "vendor rejected"/"refund
  received" write nothing further — the vendor kept the stock.
- **From customer** (open to anyone with RMA edit access): opening the case
  increments stock right away; resolving as "restocked" writes nothing
  further (already counted); resolving as "scrapped" reverses the increment
  if it turns out unsellable on inspection.

Same owner-only restriction on vendor identity as everywhere else in this
app — an employee's RMA/list/detail calls are scoped to `from_customer` only,
a `to_vendor` accessory case is invisible to them, not just read-only.

## Related

**repairs-replacements-rma**, **purchasing**, **customers-vendors**,
**open-a-replacement-job** (the accessory-replace variant reuses this same
from-customer mechanism for the old item coming back).
