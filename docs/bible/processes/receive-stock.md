---
slug: receive-stock
title: Receiving stock (serialized units and accessories)
kind: process
audience: [owner, manager, employee]
routes: [/dashboard/entry/intake, /dashboard/accessories]
keywords: [receive, intake, stock in, naya maal aaya, new stock, add stock, incoming, delivery]
sources:
  - apps/erp/app/api/stock-intake/route.ts
  - apps/erp/lib/accessory-movements.ts
updated: 2026-08-29
---

## What this is

Recording new stock arriving — either a serialized unit (laptop/desktop/
monitor/tablet, gets its own `asset_ledger` row) or a quantity of a fungible
item (an accessory, just a `stock_movements` row). Either way, it's real the
moment it's submitted — no owner approval gate.

## Steps — serialized unit

1. Open **New Entry → Intake** (`/dashboard/entry/intake`).
2. Enter/select the SKU (or create one on the fly via `resolveOrCreateSku`),
   serial number, and any known specs.
3. Submit. This creates an `asset_ledger` row with `source = 'employee_intake'`
   and `status` starting at whatever the intake flow's initial state is (not
   yet QC'd). No asset number is assigned — that only happens if/when a PO is
   attached later.
4. The unit now appears in **Live Stock**, ready for QC.

## Steps — accessories

1. Open the **Accessories** page.
2. Search or create the SKU, enter quantity received.
3. Optionally record the vendor and unit price — every role can see and enter
   this for accessories specifically (see **business-rules**' one exception).
4. Submit. This writes a positive `stock_movements` row; `sku_master.
   quantity_in_stock` updates via the sync trigger automatically — never edit
   it directly.
5. The owner can later formalize this receipt against a real PO via
   **attach-units-to-po**'s accessory path (`from-accessory-stock`).

## Related

**live-stock-qc**, **accessories**, **attach-units-to-po**, **qc-a-unit**.
