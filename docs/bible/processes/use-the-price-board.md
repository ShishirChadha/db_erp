---
slug: use-the-price-board
title: Repricing laptops on the Price Board
kind: process
module: website
audience: [owner]
routes: [/dashboard/pricing]
keywords: [price board, reprice, bulk price, change prices, competitor price, eazypc, newjaisa, undercut, aging stock, margin, website price, price badlo, daam change]
sources:
  - apps/erp/app/dashboard/pricing/page.tsx
  - apps/erp/components/pricing/PriceBoard.tsx
  - apps/erp/components/pricing/PriceBoardParts.tsx
  - apps/erp/lib/pricing.ts
  - apps/erp/lib/pricing-board.ts
  - apps/erp/lib/competitor-prices/parse.ts
  - apps/erp/lib/competitor-prices/adapters.ts
  - apps/erp/lib/competitor-prices/fetch.ts
  - apps/erp/app/api/pricing/board/route.ts
  - apps/erp/app/api/pricing/publish/route.ts
  - apps/erp/app/api/pricing/undo/route.ts
  - apps/erp/app/api/pricing/check/route.ts
  - apps/erp/app/api/pricing/links/route.ts
  - apps/erp/app/api/pricing/settings/route.ts
  - apps/erp/app/api/pricing/history/route.ts
  - apps/erp/app/api/sku-master/[id]/route.ts
  - supabase/migrations/20261020_price_board.sql
updated: 2026-10-16
---

## What this is

One screen (`/dashboard/pricing`, sidebar **Price Board**, owner only) to change
the price of many laptops and desktops quickly, one by one or in bulk, with
competitor prices (EazyPC, NewJaisa) and your own cost and margin next to each.
Nothing changes by itself: it **suggests**, you review, then publish.

**One price.** The website price and the default selling price are the same
number everywhere. Changing either (Price Board, SKU Master → Website, or the
Price Cockpit's "Save as default") writes both. A blank web price clears only
the web price. A SKU that currently has two different values is badged
*Prices differ* and becomes one number on its next save.

## Steps

1. **Change one price.** Click the price box on a laptop row, type, press
   **Enter** (jumps to the next row). The row turns amber: it is *staged*, not
   live. **Esc** cancels the edit.
2. **Change many.** Tick laptops (or "Select all shown"), pick a change in the
   bar — *Set price to*, *Add/subtract ₹*, *Change by %*, *Beat cheapest
   competitor by ₹*, *Cost + margin %* — and press **Stage changes**. Results
   follow the rounding rule (nearest ₹100 by default). Rows that cannot apply
   (no competitor price, no cost) are skipped and counted. **Use suggestions**
   stages every suggested price for the ticked (or all shown) rows.
3. **Review & publish.** The bar at the bottom shows how many are staged. The
   review lists old → new, % change and margin after. A price below cost or
   below your minimum margin is refused until you tick the confirmation box.
   Publishing writes both price fields, logs each change (Audit Log + History
   on the laptop) and goes live on the website within about a minute (ISR).
4. **Undo.** *Undo last publish* restores the whole last batch. A laptop whose
   price has been changed again since is left alone.
5. **Check competitors** reads EazyPC's and NewJaisa's public price lists
   (on demand only; at most one run per site per 10 minutes).
6. **Pricing rules** sets minimum margin (default 10%), beat-by amount
   (₹500), undercut tolerance, aging days (45), aging drop (5%) and rounding.

## How competitor matching works

A listing is matched on brand, **model number**, CPU and generation. It is
**Same config** when RAM and SSD also match: those drive the *Undercut* badge
and the suggested price. **Similar model** (different RAM/SSD) is shown for
reference and only counts once you press **Same machine**. **Not the same**
hides a listing for that laptop. Confirmed matches also log a competitor price
observation each time the price moves, so the Price Cockpit benchmark stays
current. Only the competitor's own base-warranty variant is compared (paid
extra-warranty variants are skipped); EazyPC shows its lowest listed variant
price.

## Weekly reminder

A pg_cron job (`price-weekly-review`, Mondays 09:30 IST) creates one task per
owner when any published laptop/desktop has a unit older than the aging limit:
"Weekly price review". It never changes a price.

## Common mix-ups

- **"A competitor is cheaper but there is no Undercut badge."** — Only same-config
  matches and ones you confirmed count; a similar model with other RAM/SSD is
  not a fair comparison.
- **"Price on the website did not change."** — It can take up to a minute; the
  product page revalidates every 60 s. Cart and checkout read the new price
  immediately.
- **"Margin looks wrong."** — Margin is on price and uses the average cost of
  the unit(s) in stock, falling back to the SKU's base cost.
- **Competitor site not supported** — only Shopify and WooCommerce shops with
  a public price list work; others show an error and keep manual entry in the
  Price Cockpit.

See also **use-the-price-cockpit** (single-SKU workbench, now at
`/dashboard/pricing/cockpit`) and **publish-a-sku-to-website**.
