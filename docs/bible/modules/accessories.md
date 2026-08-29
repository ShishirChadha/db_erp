---
slug: accessories
title: Accessories
kind: module
audience: [owner, manager, employee]
routes: [/dashboard/accessories]
keywords: [accessory, ram, ssd, cpu, gpu, keyboard, mouse, quantity, receive stock, stock movements, fungible]
sources:
  - apps/erp/app/api/stock/accessories/**
  - apps/erp/lib/accessory-movements.ts
  - apps/erp/app/api/purchase-orders/from-accessory-stock/route.ts
updated: 2026-08-29
---

## What this covers

Accessories are **not a separate system** — they're `sku_master` rows in the
generic `ACC` category (or any other fungible category), tracked by quantity
via `stock_movements`, with no per-unit `asset_ledger` row. See
**inventory-sku** for the serialized/fungible split this depends on.

## The receive-now, paperwork-later model

An employee can receive accessory stock immediately (`stock_movements`
insert, real the moment it's submitted) — see **receive-stock**. The owner
attaches the formal PO/vendor/cost to that receipt later, whenever they get to
it, via `/api/purchase-orders/from-accessory-stock`. This is the same
"employee entry is immediately real, owner does deferred bookkeeping"
principle from **business-rules**, applied to accessories specifically.

## The one cost/vendor visibility exception

Unlike every other cost/vendor field in the app, an accessory's
*purchase-entry* vendor + unit price (captured optionally at receipt time) is
visible to every role. This does not relax the formal PO-attach vendor/cost,
which stays owner-only. See **business-rules** for the exact boundary.

## Reconciliation

Per-accessory received/sold/adjusted/in-stock summary and purchase history are
derived live from `stock_movements` — never a stored counter — at
`/dashboard/accessories/[id]`.

## Related

**inventory-sku**, **receive-stock**, **purchasing**, **business-rules**.
