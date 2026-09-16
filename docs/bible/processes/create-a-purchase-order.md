---
slug: create-a-purchase-order
title: Creating a Purchase Order
kind: process
audience: [owner]
module: purchasing
routes: [/dashboard/purchase-orders/new, '/dashboard/purchase-orders/[id]', /dashboard/stock]
keywords: [create po, new po, po banana, vendor se saaman mangwana, purchase order, naya po, purchase order banana, create po from selected, po from stock, employee intake po, attach po]
sources:
  - apps/erp/app/dashboard/purchase-orders/new/page.tsx
  - apps/erp/app/dashboard/purchase-orders/[id]/page.tsx
  - apps/erp/components/StockView.tsx
  - apps/erp/app/api/purchase-orders/route.ts
  - apps/erp/app/api/purchase-orders/from-intake/route.ts
updated: 2026-09-16
---

## What this is

Starting a new Purchase Order — the formal vendor/cost/GST paperwork behind a
purchase. There are two different ways to create one, and they produce POs in
different states:

- **The normal New PO wizard** (`/dashboard/purchase-orders/new`) — a
  three-step form for a purchase that hasn't happened yet: pick a vendor, add
  line items by SKU, review, and submit. The PO starts as `draft` and still
  needs to be submitted and have goods received against it later (see
  **receive-stock**, **po-corrections**).
- **"Create PO from Selected" on the Stock page** — the easy-to-miss second
  entry point. Bulk-select one or more units already sitting in Live
  Stock/Stock (units that came in via employee intake, with no PO yet), then
  attach the vendor/cost/GST paperwork retroactively. This is for stock that's
  *already physically in the building* — it does not create a draft PO
  waiting to be received; see "How it differs" below.

## Who can do this

Owner only. Both `/dashboard/purchase-orders/new` and the PO detail page are
wrapped in `RequireOwner`, and the underlying API routes enforce the same
thing server-side: `POST /api/purchase-orders` and
`POST /api/purchase-orders/from-intake` both require `isOwner()`. A manager
can *view* the Purchase Orders list and detail pages (`GET` only checks
`isManagerOrAbove()`) but cannot create or edit one. Employees have no access
to Purchase Orders at all.

## Steps — normal New PO wizard

1. Open **Purchase Orders → New PO**.
2. **Step 1 (Header):** pick the vendor, PO date, expected delivery, Purchase
   Type, and Purchased By.
   - **Purchase Type** is `GST` or `Cash`.
   - **Purchased By** is `Digitalbluez`, `Techtenth`, `Cash`, or `Other` — all
     four options are present in the form; this is *not* restricted to just
     Digitalbluez/Techtenth.
3. **Step 2 (Items):** search for an existing SKU or create a new one inline
   (`SkuFormModal`), then enter quantity, unit price (before GST), and GST% —
   the Line Total field auto-computes forward from these, and editing Line
   Total directly back-solves the unit price (never the reverse when
   quantity/price/GST% themselves change — see the code comment in
   `lib/po-gst-calc.ts`). Add as many line items as needed.
4. **Step 3 (Review):** confirm vendor, date, items, and grand total, then
   **Create Purchase Order**. The PO is created with `po_status = 'draft'`.
5. From here, the PO must be **submitted**, then **received** (goods entered
   against it, serial-by-serial for serialized items or a running quantity
   for accessory lines) before an invoice can be raised against it — see
   **receive-stock** and **create-a-purchase-invoice**.

## Steps — "Create PO from Selected" (Stock page)

1. On the **Stock** page's Current or Sold tab, select one or more units with
   the row checkboxes (selection persists across tab/filter/page changes so
   you can combine units from Current and Sold into one PO).
2. Click **Create PO from Selected (N)**.
3. Pick a vendor, PO date, and Purchased By (`Digitalbluez` / `Techtenth` /
   `Cash` — no `Other` option here, unlike the normal wizard).
4. The form groups the selected units by SKU and asks for one cost price/GST%
   per distinct SKU (not per unit) — the same forward/reverse Unit
   Price↔Line Total calculation as the normal wizard.
5. Submit. This calls `POST /api/purchase-orders/from-intake`.

### How it differs from the normal wizard

- **Eligibility is narrow and enforced server-side:** every selected unit
  must have `asset_ledger.source = 'employee_intake'` and `po_id IS NULL`.
  Units already attached to a PO, or units that entered via a formal PO to
  begin with, are rejected outright (`400`, listing how many were
  ineligible).
- **The PO is created already `po_status = 'received'`**, not `draft` — there
  is no separate Submit/Receive step, because the goods are already
  physically in stock. A real asset number is minted for each unit at this
  moment via the `reserve_assets` RPC (this is the *first* time these units
  get an asset number — see `docs/bible` **manage-asset-numbering**).
  Already-sold units can be included too: their sale record is untouched,
  this step only attaches the purchase paperwork.
- **No `stock_movements` row is created** — the units were already counted as
  stock at intake time; this step is purely a numbering/vendor/cost/GST
  attachment, not a new stock-in event.

## Common mix-ups

- **"I thought Purchased By only had Digitalbluez/Techtenth."** — it doesn't;
  both entry points include a `Cash` option (and the normal wizard also has
  `Other`), alongside `Digitalbluez`/`Techtenth`.
- **"Why didn't 'Create PO from Selected' let me pick this unit?"** — it only
  works on employee-intake units with no PO yet. A unit that already has a
  PO, or came from a legacy purchase, must go through **po-corrections** or
  **attach-units-to-po** instead.
- **"The PO from Selected units is already 'received' — did I skip a step?"**
  — no, that's by design: the stock is already in-house, so there's nothing
  left to "receive."
