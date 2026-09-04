---
slug: finance-gst-reports
title: Finance, GST & Reports
kind: module
audience: [owner, manager]
routes: [/dashboard/expenses, /dashboard/reports]
keywords: [revenue, report, gst, finance, kpi, receivables, margin, expense, financial year, fy]
sources:
  - apps/erp/app/api/reports/route.ts
  - apps/erp/app/api/reports/website/route.ts
  - apps/erp/app/api/reports/search-console/route.ts
  - apps/erp/lib/reports.ts
  - apps/erp/lib/gstCalculation.ts
  - apps/erp/app/dashboard/reports/reports-client.tsx
updated: 2026-09-04
---

## The single reporting dispatcher

Every reporting number in the app — dashboard KPIs, the Reports page, digests
— goes through **one route**, `GET /api/reports`, and **one metrics layer**,
the `report_*` Postgres RPCs (`report_kpis`, `report_timeseries`,
`report_breakdown`, `report_inventory`, `report_receivables`,
`report_gst_summary`, `report_data_health`, `report_expenses`/
`report_expense_timeseries`, and — since 2026-09-04 —
`report_web_funnel`/`report_web_funnel_timeseries`/`report_website_health`).
This route never re-derives an aggregate in JS — meaning any two places
showing "revenue" always agree, because they're the same query.

The three 2026-09-04 additions are unlike every other RPC here in one way:
they're not gated by `p_include_financials` at all (no cost/vendor/margin
involved), just plain `hasPageAccess(sessionUser, 'reports')` like
`receivables`. `report_web_funnel`/`report_web_funnel_timeseries` read
straight off `cart_items`/`orders` (a cart-onward funnel only — the
storefront doesn't fire GA4 ecommerce events yet, so there's no true
site-wide funnel starting from sessions). `report_website_health` reads a new
`website_health_checks` table, populated every 5 minutes by the
`website-health-ping` `pg_cron` job (`run_website_health_check()`, which pings
`apps/web`'s public `GET /api/health` via `pg_net` and logs status/latency —
same fail-soft-on-network-error pattern as `dispatch_digests()`/
`release_expired_reservations()`).

`p_include_financials` gates cost/margin fields inside these RPCs — only true
for the owner, matching the redaction rule everywhere else. `gst_summary` and
`data_health` are owner-only entirely.

**Expenses reporting** (Reports page → Expenses tab) is purely additive on top
of this same dispatcher: `report_expenses`/`report_expense_timeseries` read
from a new `v_report_expense_lines` view, and `report_breakdown` gained two
new dimensions — `expense_type` and `expense_vendor` (fully gated behind
`p_include_financials`, owner-only, exactly like the existing `vendor`
dimension's purchasing-spend branch). None of the four original RPCs' sales/
margin logic changed. See **expenses** for the underlying data model.
`report_expenses`/`report_expense_timeseries`/the `expense_type` breakdown
also (2026-09-01) exclude any row whose `type` is one of the owner's
`custom_options.owner_only` expense types when `p_include_financials` is
false — otherwise an aggregate would leak what those hidden rows themselves
don't, e.g. total salary spend showing up in a non-owner's period total even
though no individual `Salaries` row is ever visible to them.

## Website tab — external-data exceptions to the single dispatcher

The Reports page's **Website** tab pulls from four sources: two go through
the `report_*` dispatcher above (the funnel and health RPCs), and two are
genuine exceptions because the data doesn't live in Supabase at all — each
gets its own dedicated route rather than a `report_*` RPC:

- **GA4** (2026-09-02) — sessions/pageviews/devices/demographics/geo/traffic
  source, sourced live from the **GA4 Data API** against the
  digitalbluez.com storefront's Google Analytics property, via
  `GET /api/reports/website`. `metric` namespace: `summary`, `timeseries`,
  `top_pages`, `devices`, `demographics_age`, `demographics_gender`, `geo`,
  `traffic_source`. Requires `GA4_PROPERTY_ID`, `GA4_CLIENT_EMAIL`,
  `GA4_PRIVATE_KEY` (a Google Cloud service account granted Viewer access on
  the GA4 property).
- **Search Console** (2026-09-04) — clicks/impressions/CTR/avg
  position/top queries/top pages, sourced live from Google's Search
  Analytics API via `GET /api/reports/search-console`. `metric` namespace:
  `summary`, `timeseries`, `top_queries`, `top_pages`. Requires
  `GSC_SITE_URL` plus the *same* `GA4_CLIENT_EMAIL`/`GA4_PRIVATE_KEY` service
  account (which must separately be granted access to the property under
  Search Console → Settings → Users and permissions — a manual step outside
  this codebase). Auth uses `google-auth-library`'s `JWT` client directly
  against the REST API rather than the `googleapis` SDK, since
  `google-auth-library` was already a transitive dependency via
  `@google-analytics/data` — no new npm dependency needed for this route.
- Site verification for Search Console is `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`,
  read into `apps/web/app/layout.tsx`'s `metadata.verification.google` —
  same env-var-only shape as the GA4 measurement ID, no Settings UI.

Both external routes share the same auth gate
(`hasPageAccess(sessionUser, 'reports')`), the same `reports-client.tsx`
page, and the same "return `501` if unconfigured → UI renders a plain 'not
configured' notice" pattern rather than crashing. Demographics (age/gender)
require Google Signals enabled in GA4 and real traffic volume before they
populate — an empty result here is expected for a while after setup, not a
bug; the UI says so rather than showing a misleading zero.

The storefront side of GA4 is `apps/web/components/Analytics.tsx` — a
consent-gated GA4 tag (Consent Mode default `denied`, only grants
`analytics_storage` after the visitor accepts the cookie banner). No GA4 or
Search Console data is ever written to Supabase; the ERP always reads both
live from Google at request time. `apps/web` also mounts
`@vercel/speed-insights`'s `<SpeedInsights />` (2026-09-04, next to
`<Analytics />` in the root layout) for real-user Core Web Vitals — that data
lives entirely in the Vercel dashboard, not pulled into the ERP; the Health
section of the Website tab links there rather than duplicating it, and
likewise doesn't attempt to surface function error rates (Vercel's own
Logs/Functions dashboard already covers that for free).

## Periods

Financial year is **April–March** (`financialYear()` from `@db/shared`), not
calendar year. `lib/reports.ts` provides the period helpers every report/digest
uses — today, yesterday, last 7/15 days, month-to-date, last month, fortnight
boundaries (1st–15th / 16th–end, since `pg_cron` has no native "every 15 days"),
FY-to-date. All periods resolve to plain date strings.

## The two entities

Digitalbluez (GST-registered, home state UP-09) and Techtenth (+ Cash) are two
payment/entity identities under one business — GST invoicing logic branches on
which one a sale belongs to, but they're never treated as separate vendors or
competing businesses. See **business-rules**.

## Related

**sales-invoicing**, **purchasing**, **business-rules**.
