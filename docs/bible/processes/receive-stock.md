---
slug: receive-stock
title: Receiving stock (serialized units and accessories)
kind: process
audience: [owner, manager, employee]
module: live-stock-qc
routes: [/dashboard/entry/intake, /dashboard/entry/auto-check, /dashboard/accessories]
keywords: [receive, intake, stock in, naya maal aaya, new stock, add stock, incoming, delivery]
sources:
  - apps/erp/app/api/stock-intake/route.ts
  - apps/erp/lib/accessory-movements.ts
  - apps/erp/components/IntakeUnitFields.tsx
updated: 2026-11-23
---

## What this is

Recording new stock arriving — either a serialized unit (laptop/desktop/
monitor/tablet, gets its own `asset_ledger` row) or a quantity of a fungible
item (an accessory, just a `stock_movements` row). Either way, it's real the
moment it's submitted — no owner approval gate.

For a Windows laptop or desktop, **Auto Check** (`/dashboard/entry/auto-check`)
does this stock-in and its QC in one go. It reads brand, model, serial and
specs from the machine, matches or creates the SKU, and saves through the same
`POST /api/stock-intake`. It shares the per-unit fields (date received,
purchased by, accessories, notes) with the intake form via
`components/IntakeUnitFields.tsx`. See **auto-check**.

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
   **attach-units-to-po**'s accessory path (`from-accessory-stock`). Each
   receipt keeps its own entry date there, so one delivery can be attached to
   its own vendor bill even when the same SKU has other unattached receipts.

## A laptop that comes from a customer is not entered here (2026-11-23)

When a customer hands over their old laptop in part-payment, it is taken as a
**trade-in** on the sale (see **take-a-trade-in**), which creates or reuses
its stock record itself. Such a unit never gets a vendor PO, so the owner's
**Needs PO Attached** queue (`GET /api/stock-intake`) leaves out units with
`from_trade_in`.

## Related

**live-stock-qc**, **accessories**, **attach-units-to-po**, **qc-a-unit**.
