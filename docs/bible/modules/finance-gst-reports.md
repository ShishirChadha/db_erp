---
slug: finance-gst-reports
title: Finance, GST & Reports
kind: module
audience: [owner, manager]
routes: [/dashboard/expenses, /dashboard/reports]
keywords: [revenue, report, gst, finance, kpi, receivables, margin, expense, financial year, fy]
sources:
  - apps/erp/app/api/reports/route.ts
  - apps/erp/lib/reports.ts
  - apps/erp/lib/gstCalculation.ts
  - apps/erp/app/dashboard/reports/reports-client.tsx
updated: 2026-09-01
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
new dimensions — `expense_type` (visible to any `reports`-access role, same
as the Expenses page itself) and `expense_vendor` (gated behind
`p_include_financials`, owner-only, exactly like the existing `vendor`
dimension's purchasing-spend branch). None of the four original RPCs' sales/
margin logic changed. See **expenses** for the underlying data model.

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
