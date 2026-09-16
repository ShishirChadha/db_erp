---
slug: use-the-price-cockpit
title: Using the Price Cockpit
kind: process
module: sales-invoicing
audience: [owner]
routes: [/dashboard/pricing]
keywords: [price cockpit, pricing, margin calculator, markup, vendor comparison, competitor price, market price, rate compare karna, daam nikalna, profit margin, quotation banana]
sources:
  - apps/erp/app/dashboard/pricing/page.tsx
  - apps/erp/app/api/sku-master/[id]/price-intel/route.ts
  - apps/erp/app/api/sku-master/[id]/market-observations/route.ts
updated: 2026-09-16
---

## What this is

An owner-only, single-SKU workbench (`/dashboard/pricing`) for pricing and
margin decisions — it pulls together what you've paid vendors for an item, a
live markup/margin calculator, and a log of competitor prices, so buy-side
and sell-side numbers for one item sit on one screen instead of being pieced
together across Purchasing and Sales. It's grouped under "Sales" in the
sidebar even though the vendor-comparison half is really a purchasing
view — because the whole point of the page is deciding a sell price with
full knowledge of both sides at once.

## Who can do this

Owner only. The page itself is wrapped in `RequireOwner` (a UX gate), and
every route it calls — `/api/sku-master/[id]/price-intel` and
`/api/sku-master/[id]/market-observations` — independently rejects
non-owners with 403 server-side. There's no partial/redacted view for other
roles here, because the page is cost/vendor data end to end with no
non-owner-safe subset to return.

## Steps

1. Open **Price Cockpit** (`/dashboard/pricing`) and search for an item by
   SKU code or description — any category in `sku_master` (laptops,
   desktops, monitors, tablets, accessories).
2. **Vendor Comparison** — see every vendor you've bought this exact SKU
   from, with times bought, last/min/avg price. Sourced by unioning
   `purchase_order_items`, `asset_ledger` (for cost recorded outside a
   formal PO line), and the legacy `purchases` table, aggregated live in
   memory each time — no stored aggregate to drift out of sync. Expand
   "Show full purchase history" for the line-by-line list across all three
   sources.
3. **Margin Calculator** — cost is prefilled from the most recent vendor
   price (falling back to `sku_master.base_cost` if there's no purchase
   history yet). Edit either Markup % or the Suggested Price and the other
   recalculates; edit Cost directly too. Shows margin % and profit per unit,
   plus — if any competitor prices are logged — how the suggested price
   compares to the cheapest one. From here:
   - **Copy Price** — copies the number to the clipboard.
   - **Save as Default Selling Price** — writes it to
     `sku_master.selling_price_default`.
   - **Create Quotation** — pick a customer and immediately create a
     one-line Quotation at this price, handing off to the normal
     quotation flow (see **create-a-quotation-or-proforma**).
4. **Competitor Benchmark** — log a competitor name (drawn from the
   `competitors` custom-options list), price, and optional source link each
   time you check a price elsewhere (Cashify, New Jaisa, Sudewala, etc.).
   Cheapest and median build up automatically as observations accumulate;
   delete a stale observation with the trash icon.

## Common mix-ups

- **"I can't find this page."** — It's not owner-only in name (it lives
  under the Sales nav group), but it is owner-only in access — an
  employee/manager profile simply won't see or be able to load it.
- **"The vendor comparison is empty for an item I know we've bought."** —
  It only aggregates rows carrying a vendor name and a price; check whether
  the purchase went through PO items, `asset_ledger.cost_price`, or the
  legacy `purchases` table (matched only by exact SKU code text, since it
  has no foreign key to `sku_master`) — an unusual entry path could fall
  outside all three sources.
- **"Saving the default selling price didn't update an existing
  quotation/sale."** — It only changes the SKU's *default* going forward;
  it never retroactively touches anything already created at the old price.
