---
slug: po-corrections
title: Correcting a Purchase Order after creation
kind: process
audience: [owner]
routes: [/dashboard/purchase-orders, '/dashboard/purchase-orders/[id]']
keywords: [edit po, correct po, wrong quantity, wrong price, wrong gst, wrong vendor, hsn code, already invoiced, confirm despite invoice, fix purchase order, purchase order mistake]
sources:
  - apps/erp/app/api/purchase-orders/[id]/route.ts
  - apps/erp/app/api/purchase-orders/[id]/items/[itemId]/route.ts
  - apps/erp/components/EditPoItemDialog.tsx
  - apps/erp/components/EditPoVendorDialog.tsx
  - apps/erp/lib/po-gst-calc.ts
updated: 2026-08-30
---

## What this is

Fixing a mistake on a PO *after* it was created — wrong quantity, price,
GST%, vendor, or HSN code — without losing the paperwork trail. Owner-only.
Distinct from **attach-units-to-po** (which adds units/backlog that were
never on the PO at all).

## Two edit paths, by PO status

- **Draft** — no reservations or receipts exist yet, so a correction is a
  full line-item replace: `PUT /api/purchase-orders/[id]`. No reason
  required, no already-invoiced check (a draft can't be invoiced).
- **Anything past draft** (submitted/partially_received/received/invoiced) —
  `PATCH /api/purchase-orders/[id]/items/[itemId]` for quantity/price/GST%,
  or `PATCH /api/purchase-orders/[id]` for the vendor. Both require an
  optional "reason" field (logged, not enforced) and are floored/guarded so
  a correction never silently disagrees with physical reality.

`EditPoItemDialog` picks the right path automatically based on `poStatus`.

## Before/after-GST fields, shared everywhere

`lib/po-gst-calc.ts`'s `computeFromUnitPrice`/`computeFromLineTotal` is the
one calculation both the New PO wizard, `AttachUnitsDialog`'s cost inputs,
and `EditPoItemDialog` use — editing Unit Price (before GST) recalculates
Line Total (incl. GST) forward; editing Line Total back-solves Unit Price.
Never a fourth reimplementation of this formula.

## Quantity correction — floored at what's already committed, by category

- **Serialized** (laptop/desktop/monitor/tablet): floor = count of
  `asset_ledger` rows already carrying a serial number. Reducing below that
  is rejected outright (can't un-serial a physically-received unit this
  way — see **attach-units-to-po**'s move-unit for relocating a specific
  unit instead). Increasing reserves more asset numbers via the same
  `reserve_assets()` RPC `/submit` uses; decreasing (down to the
  serial-tagged floor) deletes still-unreceived reserved placeholder rows.
- **Fungible** (accessories): there's no "serial-tagged" concept, so the
  floor is instead **how much of this line's quantity already has a real
  `stock_movements` row behind it** (`'receipt'` + this endpoint's own prior
  `'adjustment'` corrections, summed by `po_item_id`). Below that floor,
  quantity has no more "ordered but not yet received" headroom left — the
  common case for any line created via `attach-accessory-stock`/
  `from-accessory-stock`, which start 100% received immediately. Once
  there's no headroom, **any** quantity edit writes a compensating
  `'adjustment'` movement so `sku_master.quantity_in_stock` stays truthful:
  a decrease is guarded so it can never claim back more than what's still
  unsold (checked against live `quantity_in_stock`, since sold units can't
  be "un-received"); an increase adds the difference straight to stock.
  While there's still real ordered-but-unreceived headroom above the floor,
  quantity edits stay pure paperwork with no stock touch, same as before.

## Price/GST correction — propagates to every copy

Changing `base_price`/`gst_percentage` on a line updates the line itself,
then propagates onto every `asset_ledger` row already tied to it (any
status, never touches `status` itself) and, for a fungible line, onto
`sku_master.base_cost` — the same unconditional-overwrite convention the
receive route already uses.

## HSN code — lives on the SKU, not the PO line

`purchase_order_items` has no `hsn_code` column; the PO detail page's HSN
column is `sku.hsn_code`. `EditPoItemDialog`'s HSN field writes straight
through to `PUT /api/sku-master/[id]` — correcting it here updates the SKU
everywhere it's used, not just this one PO.

## The already-invoiced guard

Mirrors `apps/erp/app/api/sales/[id]/route.ts`'s pattern exactly: if a
Purchase Invoice already exists for this PO, a correction is blocked with
`409 { error_code: 'already_invoiced' }` unless the request includes
`confirm_despite_invoice: true` — an invoice is a frozen snapshot
(**purchasing**) and is never retroactively recomputed, so the UI shows a
warning and lets the owner explicitly proceed anyway.

## Related

**purchasing**, **attach-units-to-po**, **business-rules** (numbering RPCs,
never a client-side counter).
