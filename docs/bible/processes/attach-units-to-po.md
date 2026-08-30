---
slug: attach-units-to-po
title: Attaching units to a Purchase Order (retroactive paperwork)
kind: process
audience: [owner]
routes: [/dashboard/purchase-orders]
keywords: [attach units, attach po, reserve assets, po paperwork, formalize purchase, link po, move unit, move po, existing po, add units from stock, entry date]
sources:
  - apps/erp/app/api/purchase-orders/from-intake/route.ts
  - apps/erp/app/api/purchase-orders/from-accessory-stock/route.ts
  - apps/erp/app/api/purchase-orders/[id]/attach-units/route.ts
  - apps/erp/app/api/purchase-orders/[id]/attach-accessory-stock/route.ts
  - apps/erp/app/api/purchase-orders/[id]/move-unit/route.ts
  - apps/erp/components/AttachUnitsDialog.tsx
  - apps/erp/components/MoveUnitDialog.tsx
updated: 2026-08-30
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

## Two destinations: a brand-new PO, or an existing one

Every attach mechanism below comes in two shapes:

- **Mint a new PO** (`from-intake`, `from-accessory-stock`) — the PO is
  created fresh, `po_status` starts at `'received'` directly (there's nothing
  left to receive; the stock is already physically here).
- **Attach onto an existing PO** (`attach-units`, `attach-accessory-stock`) —
  for when a laptop purchase and an accessory purchase were on the *same*
  vendor invoice and should end up as two lines on *one* PO, or when the
  owner already made a PO for some of an invoice's units and just forgot one.
  Each attached unit/backlog quantity always becomes its **own new line
  item** on the target PO (never merged into an existing line for the same
  SKU) — merging would silently blend two different batches' price/GST into
  one number.

Both shapes share the same eligibility rule and never touch a unit's
operational fields (`status`, QC, sale) — only paperwork (`po_id`,
`po_item_id`, `asset_number`, `cost_price`, `vendor_id`, `gst_percentage`).

## Steps — serialized units (`from-intake` / `attach-units`)

1. From the PO detail page, "+ Add Units from Stock" opens
   `AttachUnitsDialog` — searches `employee_intake` units with no PO yet
   (`GET /api/stock?source=employee_intake`), by serial number, model, or
   description.
2. Pick one or more units, enter their purchase cost/GST per SKU group, submit.
3. `reserve_assets()` is the **only** place asset numbers get minted for
   these units — they've had none until this moment.

`attach-units` (existing PO) and `from-intake` (new PO) share this exact
eligibility/reservation logic; the only difference is whether a fresh
`purchase_orders` row is created first.

## Steps — accessories (`from-accessory-stock` / `attach-accessory-stock`)

1. `AttachUnitsDialog` also lists accessory SKUs with unattached backlog
   quantity (`GET /api/purchase-orders/from-accessory-stock`) alongside
   serialized units, so a laptop + RAM on one invoice can be attached to one
   PO in a single dialog. The Accessories page's own "Attach PO" control
   (`AttachPoControl`) offers the same New PO / Existing PO choice directly
   from a SKU's backlog badge.
2. Submit. No asset numbers involved — accessories never get them; this just
   links the SKU's unattached `stock_movements` `'receipt'` rows to the PO
   and creates one `quantity = N` line (N = however much is still
   unattached for that SKU).
3. The backlog listing (and `attach-accessory-stock`'s POST) explicitly
   **excludes serialized categories** — a laptop also gets a `'receipt'`
   movement on intake (the universal quantity cache spans every category),
   but its own attach path is `attach-units`/`from-intake`, not this one.
   Calling `attach-accessory-stock` on a serialized SKU is rejected with a
   clear error pointing at "Add Units from Stock" instead.
4. Sold/bundled quantity is a separate `'sale'`-type movement and never
   reduces how much unattached `'receipt'` quantity is still here to
   formalize — the backlog count only ever grows on receipt, never shrinks
   on sale.

## Correcting a mistake: moving a unit between two POs

`move-unit` (`MoveUnitDialog`, a "Move" link next to each unit's entry date
on the PO detail page) reassigns one already-attached serialized unit from
its current PO onto a different *existing* PO — e.g. a laptop purchased on
the 25th that got mistakenly attached to the 10th's PO. Mechanically: shrinks
the source line by exactly one (deleting it outright if it was the line's
last unit — a line can't have `quantity = 0`), and creates a fresh
single-quantity line on the target PO carrying the unit's own existing
cost/GST forward unchanged. The unit's `asset_number`/`serial_number`/status
are never touched. Same already-invoiced warn-and-confirm gate as any other
PO correction (**po-corrections**), checked against *both* the source and
target PO.

Each unit's **entry date** (`asset_ledger.created_at` — when it was actually
entered/reserved, distinct from the PO's own `po_date`) is shown next to its
asset number specifically so the owner can tell apart units from different
purchase dates sitting on the same PO line before deciding what to move.
Fungible/accessory SKUs have no per-unit identity to move this way — moving
accessory quantity between two POs is a quantity correction on each line
directly (`PATCH /api/purchase-orders/[id]/items/[itemId]`), not this route.

## Related

**purchasing**, **live-stock-qc**, **accessories**, **business-rules**,
**po-corrections**.
