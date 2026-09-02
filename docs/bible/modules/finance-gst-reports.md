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
  - apps/erp/lib/reports.ts
  - apps/erp/lib/gstCalculation.ts
  - apps/erp/app/dashboard/reports/reports-client.tsx
updated: 2026-09-02
---

## The single reporting dispatcher

Every reporting number in the app — dashboard KPIs, the Reports page, digests
— goes through **one route**, `GET /api/reports`, and **one metrics layer**,
the `report_*` Postgres RPCs (`report_kpis`, `report_timeseries`,
`report_breakdown`, `report_inventory`, `report_receivables`,
`report_gst_summary`, `report_data_health`, and — since 2026-09-01 —
`report_expenses`/`report_expense_timeseries`). This route never re-derives an
aggregate in JS — meaning any two places showing "revenue" always agree,
because they're the same query.

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

## Website tab — the one exception to the single dispatcher

The Reports page's **Website** tab (2026-09-02) is the one metric group that
does **not** go through `/api/reports`'s `report_*` RPC dispatcher, because
its data doesn't live in Supabase at all: it's sourced live from the **GA4
Data API** against the digitalbluez.com storefront's Google Analytics
property, via a dedicated route, `GET /api/reports/website`. Same auth gate
(`hasPageAccess(sessionUser, 'reports')`) and same `reports-client.tsx` page,
but a separate `metric` namespace (`summary`, `timeseries`, `top_pages`,
`devices`, `demographics_age`, `demographics_gender`, `geo`,
`traffic_source`) and its own fetch helper (`getWebsiteReport`, distinct from
`getReport`).

Requires three server env vars with no fallback — `GA4_PROPERTY_ID`,
`GA4_CLIENT_EMAIL`, `GA4_PRIVATE_KEY` (a Google Cloud service account granted
Viewer access on the GA4 property) — the route returns `501` if any are
missing, which the UI renders as a plain "not configured" notice rather than
a crash. Demographics (age/gender) require Google Signals enabled in GA4 and
real traffic volume before they populate — an empty result here is expected
for a while after setup, not a bug; the UI says so rather than showing a
misleading zero.

The storefront side of this is `apps/web/components/Analytics.tsx` — a
consent-gated GA4 tag (Consent Mode default `denied`, only grants
`analytics_storage` after the visitor accepts the cookie banner). No
analytics data is ever written to Supabase; the ERP always reads it live from
Google at request time.

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
