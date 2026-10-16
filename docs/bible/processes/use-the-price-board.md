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
  - apps/erp/lib/competitor-prices/jsonld.ts
  - apps/erp/lib/competitor-prices/probe.ts
  - apps/erp/components/pricing/CompetitorMatrix.tsx
  - apps/erp/components/pricing/CompetitorsDialog.tsx
  - apps/erp/app/api/pricing/market/route.ts
  - apps/erp/app/api/pricing/competitors/route.ts
  - apps/erp/app/api/pricing/board/route.ts
  - apps/erp/app/api/pricing/publish/route.ts
  - apps/erp/app/api/pricing/undo/route.ts
  - apps/erp/app/api/pricing/check/route.ts
  - apps/erp/app/api/pricing/links/route.ts
  - apps/erp/app/api/pricing/settings/route.ts
  - apps/erp/app/api/pricing/history/route.ts
  - apps/erp/app/api/sku-master/[id]/route.ts
  - supabase/migrations/20261020_price_board.sql
  - supabase/migrations/20261021_competitor_matrix.sql
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
5. **Check competitors** reads every enabled competitor's public prices (on
   demand only; sites run in parallel; at most one run per site per 10 minutes).
6. **Pricing rules** sets minimum margin (default 10%), beat-by amount
   (₹500), undercut tolerance, aging days (45), aging drop (5%) and rounding.

## The Competition section (detail pane)

Open a laptop and scroll to **Competition**. It shows the market for that
**model** across every competitor: the price range, the cheapest
**like-for-like** price (same RAM and SSD, competitor warranty 6 months or
more) and the cheapest price of the model in any configuration. Below, for
each competitor and product, **every variant** is listed (RAM / SSD,
warranty, condition if the shop states one, price, sold out) with the ₹
difference from your price. Like-for-like variants are highlighted and first.

You read this section, then decide the price: the system never converts a
price between configurations. The list row shows the like-for-like price when
there is one (this drives the **Undercut** badge and the suggested price), or
an amber **Model low** chip (reference only) when only a different RAM/SSD is
on sale.

**Same model** means same brand, model number, CPU and generation. Wrong
match? **Not this model** hides that competitor product for this laptop (it
stays listed under "hidden", with **Show again**). **This model** forces a
product in when the automatic match missed it.

## Competitors (add / remove)

**Competitors** on the board lists the sites whose prices are read, with a
status (readable / blocks automated readers / last check failed). You can
switch price checks off, remove a site (this also removes its stored prices,
your decisions and its Website SEO analysis) or **add** one. Adding first
tests the site: if it answers with a bot check (for example Cloudflare), its
robots.txt forbids us, or it has no readable price list, you are warned and
must choose **Add anyway** (then it is kept for the SEO analysis but its prices
are not shown). The same warning appears in Website SEO → Competitor websites.
Electronics Bazaar was removed because it blocks every automated reader; the
tool never tries to get around such protection.

How prices are read (auto-detected, no AI involved): a Shopify price list
(`/products.json`), the WooCommerce store API (every RAM/SSD/warranty
variation), or, for shops like Edify, the schema.org price markup on product
pages (only models you carry, at most 80 pages per check). Paid extra-warranty
variants are shown with their total warranty (for example 18 months).

## Weekly reminder

A pg_cron job (`price-weekly-review`, Mondays 09:30 IST) creates one task per
owner when any published laptop/desktop has a unit older than the aging limit:
"Weekly price review". It never changes a price.

## Common mix-ups

- **"A competitor is cheaper but there is no Undercut badge."** — Only a
  like-for-like variant (same RAM and SSD, warranty 6 months or more) counts; a
  cheaper 8 GB variant shows as Model low and is for you to judge.
- **"Price on the website did not change."** — It can take up to a minute; the
  product page revalidates every 60 s. Cart and checkout read the new price
  immediately.
- **"Margin looks wrong."** — Margin is on price and uses the average cost of
  the unit(s) in stock, falling back to the SKU's base cost.
- **Competitor site not readable** — a site behind a bot check, or with no
  price list or price markup, cannot be read; keep its prices in the Price
  Cockpit by hand.

See also **use-the-price-cockpit** (single-SKU workbench, now at
`/dashboard/pricing/cockpit`) and **publish-a-sku-to-website**.
