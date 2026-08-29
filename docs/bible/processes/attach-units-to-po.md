---
slug: attach-units-to-po
title: Attaching units to a Purchase Order (retroactive paperwork)
kind: process
audience: [owner]
routes: [/dashboard/purchase-orders]
keywords: [attach units, attach po, reserve assets, po paperwork, formalize purchase, link po]
sources:
  - apps/erp/app/api/purchase-orders/from-intake/route.ts
  - apps/erp/app/api/purchase-orders/from-accessory-stock/route.ts
  - apps/erp/app/api/purchase-orders/[id]/attach-units/route.ts
updated: 2026-08-29
---

## What this is

The owner's deferred-bookkeeping step: giving a unit or accessory receipt that
already exists (entered by an employee, already possibly QC'd or even sold)
its formal Purchase Order, vendor, and cost. This is owner-only.

## Why this exists as a separate step

Employee stock entries are immediately real and don't wait for a PO
(**business-rules**). QC and sales happen on their own schedule, independent
of when the owner gets around to the paperwork. So attaching a PO must never
be blocked by — or itself block — a unit's operational lifecycle. This route
accepts units in **any** status, including already-`sold`.

## Steps — serialized units (`from-intake`)

1. From a Purchase Order (existing or new), choose the units to attach — by
   serial number, searched against `employee_intake` units without a PO yet.
2. Submit. This calls `reserve_assets()`, which is the **only** place asset
   numbers get minted for these units — they've had none until this moment.

## Steps — accessories (`from-accessory-stock`)

1. From a Purchase Order, choose an accessory receipt (a `stock_movements`
   entry) to formalize.
2. Submit. No asset numbers involved — accessories never get them; this just
   links the existing quantity movement to a real PO/vendor/cost.

## Related

**purchasing**, **live-stock-qc**, **accessories**, **business-rules**.
