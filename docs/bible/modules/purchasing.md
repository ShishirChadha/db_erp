---
slug: purchasing
title: Purchasing (Purchase Orders & Purchase Invoices)
kind: module
audience: [owner, manager]
routes: [/dashboard/purchase-orders, /dashboard/purchase-invoices, /dashboard/purchases]
keywords: [purchase, po, purchase order, kharidna, vendor bill, purchase invoice, stock intake, reserve assets, move unit, edit po, correct po]
sources:
  - apps/erp/app/api/purchase-orders/**
  - apps/erp/app/api/purchase-invoices/**
  - apps/erp/lib/purchase-utils.ts
updated: 2026-08-30
---

## What this covers

Formal purchasing paperwork — Purchase Orders (line items, vendor, quantities)
and Purchase Invoices (the vendor's bill against one or more POs). This is
owner/manager territory; it's the deferred bookkeeping side of purchasing, not
the operational "stock just arrived" side (see **live-stock-qc** and
**accessories** for that — units and quantity can enter the system, be QC'd,
and even be sold before a PO is ever attached to them).

There's also `/dashboard/purchases` — labelled "OLD Purchase IN" in the nav —
a legacy pipeline kept read-visible for historical data, not the active flow.

## Key concepts

- **`purchase_orders` / `purchase_order_items`** — the PO itself and its line
  items. A line item for a serialized category (laptop/desktop/monitor/tablet)
  reserves specific `asset_ledger` rows via the `reserve_assets()` RPC; a line
  item for a fungible/quantity-only category (most accessories) is just a
  `quantity = N` row, no per-unit reservation.
- **Attaching units/backlog to a PO** (`from-intake`, `from-accessory-stock`,
  `attach-units`, `attach-accessory-stock`) is how units/quantity that
  entered via employee intake or accessory receipt get their formal
  paperwork retroactively — either onto a brand-new PO or an already-created
  one, so one vendor invoice covering a laptop and an accessory can end up
  as two lines on one PO. See **attach-units-to-po**.
- **Correcting a PO after creation** (wrong quantity/price/GST/vendor/HSN,
  or a unit that landed on the wrong PO entirely via `move-unit`) — see
  **po-corrections**.
- **`purchase_invoices`** — the vendor's actual bill, which can span multiple
  POs. This is where GST input credit tracking lives. Once generated, an
  invoice is a frozen snapshot — a later PO correction never retroactively
  updates it (**po-corrections**' already-invoiced guard).

## Related

**receive-stock**, **attach-units-to-po**, **po-corrections**,
**finance-gst-reports** (for GST input-side treatment), **business-rules**
(asset numbering is a PO artifact, never an inventory-existence requirement).
