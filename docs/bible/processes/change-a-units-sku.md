---
slug: change-a-units-sku
title: "Changing a unit's SKU (recording a spec upgrade or downgrade)"
kind: process
module: inventory-sku
audience: [owner, manager, employee]
routes: [/dashboard/stock, /dashboard/entry/sell]
keywords: [fix sku, change sku, reassign sku, upgrade, downgrade, ram upgrade, ssd upgrade, spec change, wrong sku, correct sku, current_sku_id, component stock, upgraded ram, upgraded ssd]
sources:
  - apps/erp/components/FixSkuDialog.tsx
  - apps/erp/app/api/asset-ledger/[id]/reassign-sku/route.ts
  - apps/erp/lib/effective-sku.ts
updated: 2026-09-16
---

## What this is

Changing which SKU a specific unit (one row in `asset_ledger`) currently
represents — either because it was mis-entered originally, or because staff
physically upgraded or downgraded a component (most often RAM or SSD) before
reselling it. This is the "upgrade/downgrade" functionality that lives on a
unit itself — separate from **manage-upgrade-pricing**, which is the
*website's* paid checkout upsell feature.

Two entry points share the same dialog (`FixSkuDialog`, titled "Change SKU"
or "Fix SKU" depending on where it's opened):
- **Stock page** ("Fix SKU" button) — correcting a data-entry mistake.
- **Sell form** ("Change SKU") — recording a real physical upgrade right
  before the sale.

## Who can do this

Open to any signed-in staff member with the edit grant on the page it's
opened from (the Stock page's edit grant, or New Entry access for the Sell
form) — **not owner-only**, unlike most SKU-master editing. The optional
"additional cost" field is owner-only, since cost is never shown to
employees.

## What it does and doesn't change

It only ever sets `current_sku_id` on **this one unit** — never
`asset_ledger.sku_id` or `purchase_order_items.sku_id`, which stay an
accurate record of what was actually purchased, no matter what happens to
the unit afterward. So:
- It never rewrites the original Purchase Order.
- It never affects any sibling unit that shares the same PO line item.
- Everywhere else that reads a unit's "current" spec (Sales Ledger, Live
  Stock, the website) resolves it through `current_sku_id` first, falling
  back to the original purchased spec — see **inventory-sku**.

If the unit is already on a **finalized invoice**, reassigning warns first
("this will NOT update that invoice, which will then disagree with the live
system") and requires an explicit confirm to proceed — it doesn't block it
outright, since a real physical upgrade after invoicing is a legitimate
situation, just one worth a conscious decision.

## Steps

1. Open **Change SKU** / **Fix SKU** on the unit.
2. Search for the correct SKU, or create a new one on the spot if it doesn't
   exist yet.
3. Confirm the reassignment.
4. If the unit is already on a finalized invoice, confirm again explicitly.
5. (Owner only, optional) Enter the additional cost and a reason — this is
   recorded as a cost adjustment on the unit, the same mechanism the Stock
   page's cost-adjustment history uses.
6. **If RAM or SSD actually changed** (the only two fields this
   automatically diffs), a follow-up step appears — one row per changed
   field:
   - **Upgrade** (e.g. RAM 8GB → 16GB): "if it came from your own accessory
     stock, deduct it now" — optionally search for the RAM/SSD SKU that was
     used and deduct it from stock.
   - **Downgrade** (e.g. SSD 512GB → 256GB): "log the removed component back
     into stock?" — optionally search for the SKU and receive it back in.
   - Either row can be skipped if it doesn't apply (e.g. the part was
     sourced externally, not from our own stock).

A reassignment that doesn't change RAM/SSD (a plain data-entry correction, or
a change to some other field) skips the follow-up step entirely and closes
immediately.

## Common mix-ups

- **"I changed the SKU but nothing asked about stock."** — the automatic
  upgrade/downgrade follow-up only fires for RAM and SSD specifically; other
  spec fields (CPU, screen size, etc.) don't trigger it.
- **"Why didn't this update the Purchase Order?"** — by design; see "What it
  does and doesn't change" above. Use **po-corrections** if the PO record
  itself is actually wrong.
- **"The invoice still shows the old spec."** — expected; a finalized
  invoice is a frozen snapshot and is never retroactively updated by a later
  SKU reassignment.
