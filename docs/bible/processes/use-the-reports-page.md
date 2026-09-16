---
slug: use-the-reports-page
title: Using the Reports Page
kind: process
module: finance-gst-reports
audience: [owner, manager, employee]
routes: [/dashboard/reports]
keywords: [reports, dashboard reports, sales report, GST report, profitability, inventory ageing, expenses report, cash receivables, website analytics, google analytics, search console, data health, hisaab kitaab, business report dekhna, not configured, 501]
sources:
  - apps/erp/app/dashboard/reports/reports-client.tsx
  - apps/erp/app/dashboard/reports/page.tsx
  - apps/erp/app/api/reports/route.ts
  - apps/erp/app/api/reports/website/route.ts
  - apps/erp/app/api/reports/search-console/route.ts
updated: 2026-09-16
---

## What this is

A single reporting surface (`/dashboard/reports`) with ten tabs covering
sales, margins, inventory, purchasing, expenses, cash, and GST, plus a
Website tab that pulls in live analytics. Every internal number is backed
by SQL RPCs (`report_*`) dispatched through one route (`/api/reports`) —
this replaced an older version of the page that pulled whole tables
client-side and reduced them in the browser, silently truncated at
PostgREST's row cap. Every figure here is now a server-side aggregate.

## Who can do this

Any signed-in staff member with the `reports` page grant can open the page
(owner always has it; manager/employee need it granted). Financial figures
within it are gated separately and server-side, independent of the page
grant: `/api/reports` sets `p_include_financials = isOwner(sessionUser)` on
every RPC call, and cost/vendor/margin fields are omitted from a non-owner's
response rather than fetched-then-redacted. Two whole tabs (**Profitability**,
**Purchasing & Vendors**) and two metrics (`gst_summary`, `data_health`) are
gated shut entirely for non-owners with a 403/placeholder, rather than
partially shown.

## Filters

- **Date range presets** across the top: Month to Date, Last 7 Days, Last 15
  Days, Last Month, FY to Date — applied globally, driving every tab's
  period plus an automatically-computed prior-period comparison for growth
  percentages.
- There's no separate entity filter on the page; the **GST** tab instead
  breaks its own numbers out "by Month & Entity".

## The tabs

1. **Overview** — headline tiles (Revenue, Units Sold, Collections /
   Outstanding, New / Repeat Customers, and — owner only — Gross Margin on
   costed units) plus a daily revenue chart. A warning banner appears if
   cost coverage for the period is under 50%, since the margin figure then
   only reflects the costed subset.
2. **Sales** — revenue by brand/staff/entity, a GST-vs-Cash split pie, and
   top customers.
3. **Profitability** — owner only. Cost coverage %, revenue/COGS/margin on
   the costed subset, margin by category, and a callout that sold units
   with no recoverable cost are excluded from margin rather than treated as
   zero-cost — pointing at attaching a PO to close the gap.
4. **Inventory & Ageing** — sellable / on-hand / QC-pending / faulty unit
   counts, a "sold with no sale record" data-integrity flag, a stock ageing
   chart, and (owner only) stock value at cost; accessories needing a
   reorder PO.
5. **Purchasing & Vendors** — owner only. Spend and units by vendor for the
   period.
6. **Expenses** — total/count/average, a daily chart, breakdown by type
   (any role) and by vendor (owner only).
7. **Cash & Receivables** — receivables ageing buckets and top outstanding
   customers; visible to any role since it's collections status, not
   cost/vendor/margin.
8. **GST** — owner only. Count of GST sales not yet invoiced in the period,
   and output GST by month & entity.
9. **Website** — see below.
10. **Data Health** — owner only. Counts of specific data-integrity gaps
    (sold assets with no sale row, sales with no recoverable cost, SKUs
    with no base cost, stock receipts with no unit price, PO line items
    with no price, etc.) — closing these is literally what raises Cost
    Coverage % everywhere else on the page.

## The Website tab — a real setup gotcha

Unlike every other tab, Website mixes internal ERP data with **two live
external API calls** made at request time — not stored in Supabase at all:

- The **Traffic** section calls Google Analytics 4's Data API
  (`/api/reports/website`), and needs `GA4_PROPERTY_ID`,
  `GA4_CLIENT_EMAIL`, and `GA4_PRIVATE_KEY` set on the server.
- The **Search** section calls Google Search Console's Search Analytics API
  (`/api/reports/search-console`), and needs `GSC_SITE_URL` — it reuses the
  same `GA4_CLIENT_EMAIL` / `GA4_PRIVATE_KEY` service account, which must
  *separately* be granted access to the Search Console property itself.

If those env vars aren't set, each route returns **HTTP 501** with an
explicit "isn't configured on this server yet" error. The page catches that
and renders an inline warning banner in place of just that section, rather
than failing the whole tab. **This is expected behavior, not a bug** —
someone hitting a blank Traffic or Search section with a "not configured"
banner should go check the env vars, not assume something broke.

The **Funnel** (cart → checkout → purchase) and **Health** (uptime/latency)
sub-sections lower on the same tab are unaffected either way — they're
built from the ERP's own `orders`/`cart_items` records and a health-check
table respectively, not from Google's APIs, so they render normally even
when Traffic/Search show the 501 banner.

Demographics (Age/Gender) can also come back empty even when GA4 *is*
correctly configured — that's a separate, normal empty state: Google
Signals demographics need enough accumulated traffic before they populate,
which can take days to weeks after first enabling, not a configuration
problem.

## Common mix-ups

- **"Profitability / Purchasing / GST tabs are blank or say owner-only for
  me."** — Expected for manager/employee; the `reports` page grant gets you
  onto the page, not into the financial tabs within it.
- **"Website tab shows a yellow 'not configured' banner."** — Not a bug.
  Check `GA4_PROPERTY_ID` / `GA4_CLIENT_EMAIL` / `GA4_PRIVATE_KEY` (needed
  for Traffic) and additionally `GSC_SITE_URL` (needed for Search) are set
  on the server, and that the GA4 service account has also been granted
  access to the Search Console property.
- **"Demographics (Age/Gender) charts are empty even though GA4 works fine
  elsewhere on this tab."** — Different cause from the 501 case: Google
  Signals demographics simply need more accumulated traffic before they
  populate at all.
- **"Where are Core Web Vitals / function error logs?"** — Not here by
  design; the page links out to the Vercel dashboard (Speed Insights and
  Logs tabs) instead of duplicating them.
