---
slug: finance-gst-reports
title: Finance, GST & Reports
kind: module
audience: [owner, manager]
routes: [/dashboard/expenses, /dashboard/reports, /dashboard/gst]
keywords: [revenue, report, gst, finance, kpi, receivables, margin, expense, financial year, fy, gstr1, gstr-1, gstr3b, gstr-3b, return, filing, hsn, b2b, b2cs, place of supply, gst return bharna]
sources:
  - apps/erp/app/api/reports/route.ts
  - apps/erp/app/api/reports/website/route.ts
  - apps/erp/app/api/reports/search-console/route.ts
  - apps/erp/lib/reports.ts
  - apps/erp/lib/gstCalculation.ts
  - apps/erp/app/dashboard/reports/reports-client.tsx
  - apps/erp/app/api/gst/returns/route.ts
  - apps/erp/app/dashboard/gst/gst-client.tsx
  - apps/erp/lib/gst-returns.ts
  - packages/shared/src/gstStateCodes.ts
  - apps/erp/app/api/gst/recon/route.ts
  - apps/erp/app/api/gst/filings/route.ts
  - apps/erp/app/api/gst/period-locks/route.ts
  - apps/erp/lib/recon/gst-zoho-matcher.ts
  - apps/erp/lib/recon/gst-2b-matcher.ts
  - apps/erp/lib/period-lock.ts
  - apps/erp/app/api/credit-notes/route.ts
  - apps/erp/app/api/gst/exclusions/route.ts
  - apps/erp/app/api/sales-entry/route.ts
  - apps/erp/lib/sales-cart.ts
updated: 2026-10-05
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

## Rental income is reported separately

`v_report_sale_lines.line_kind` gained a `'rental'` value, so rent never inflates unit
sales figures and can be sliced out on its own. Because a rent charge has no
`asset_ledger_id`, it also comes back with `cogs_known = false` — a laptop's purchase
cost is never counted as the cost of one month's rent. A rent-to-own buyout stays
`line_kind = 'unit'` with real COGS.

`report_rentals(p_from, p_to)` gives the rental picture on its own: active agreements,
units on rent, overdue count, rent billed/collected/outstanding, and `deposits_held`.
Deposits are reported apart from every revenue figure because a held deposit is a
liability, not income. See **rentals**.

## GST returns (GSTR-1 / GSTR-3B)

`/dashboard/gst` is a separate workspace from the Reports page's GST tab. Reports
answers "what did we collect"; this answers "can we file". **Owner-only**, and
`/api/gst/returns` enforces that server-side on every metric — the page guard is
UX only.

**Only a GST-registered entity has a return.** The entity list comes from
`business_profiles.is_gst_registered`, never from matching an entity name, so
Digitalbluez is the only one today. Asking for Techtenth or Cash returns
`not_registered` rather than an empty return.

**The return is keyed on `invoices.invoice_date`**, which is the legally correct
date and also sidesteps the `sale_date` vs `effective_sale_date` drift that
affects the rest of reporting. The completeness check, which looks at sales with
*no* invoice, uses `effective_sale_date` instead.

### Validation comes before export, not after

`v_gst_exceptions` is a live view — derived, never stored, the same principle as
`/dashboard/pending-tasks`. A fixed record simply stops appearing; there is no
status to go stale. Rows are grouped Transactions / HSN Summary / Document
Summary, and split `blocker` vs `warning`. **Blockers set `can_generate = false`**
for the period, because the portal rejects a whole upload on a schema violation
and an incomplete return silently under-reports.

Checks worth knowing about:
- `gst_sale_not_invoiced` — a taxed sale with no invoice is absent from the
  return entirely. This is the one failure mode that under-reports rather than
  being rejected.
- `doc_series_gap` — gaps in the invoice number series. Table 13 needs every
  number explained as issued or cancelled, so a gap is either a cancellation or
  an invoice never recorded.
- `invoice_line_hsn_unresolvable` — a line with no HSN on itself, its SKU, or a
  linked SAC. These drop out of Table 12 while still counting in Tables 4/5/7,
  which is exactly the mismatch the portal cross-validates.
- `tax_computation_mismatch`, `wrong_tax_type`, `zero_gst_on_gst_entity` — tax
  arithmetic and head selection against place of supply.

`gstin_is_valid()` in SQL mirrors `isValidGstinChecksum()` in `@db/shared`
(mod-36 check digit). Keep the two in step. Both prove a GSTIN is *well-formed*,
never that it is registered or active — only the taxpayer lookup in `/api/gst`
speaks to that.

### HSN resolution has a deliberate fallback

`v_gst_outward_lines` resolves a line's HSN in precedence order: the invoice
line's own code, then the SKU's current `hsn_code`, then the SKU's SAC. The
fallback exists because most historical lines were written before HSN was
captured; without it Table 12 reported about a quarter of the taxable value
while Tables 4/5/7 reported all of it. **Nothing is rewritten on the stored
invoice** — a filed line's own code stays authoritative and this resolves only
at report time.

### Section routing

`gstr1_section` on `v_gst_outward_lines`: a recipient GSTIN makes it `b2b`
regardless of value; otherwise inter-state above the threshold is `b2cl` and
everything else consolidates into `b2cs`. **The B2CL threshold is date-aware** —
₹1,00,000 from the August 2024 return period (Notification 12/2024-CT), ₹2,50,000
before — because a historical period has to be classified by the rule in force
then.

### What the ERP does and does not do

It **generates files; it does not file.** GSTN issues returns APIs only to
empanelled GSPs, with no direct-taxpayer channel and a per-taxpayer OTP that
rules out unattended filing, so the owner uploads at gst.gov.in. Output is one
CSV per section via `lib/gst-returns.ts`, with column headers matching the
portal's offline-tool templates and **`dd-mmm-yyyy` dates — which those
templates require and which is deliberately not the `DD-MM-YYYY` the portal
JSON uses.** Two transports, two formats; don't share a formatter.

**GSTR-3B is output-side only for now.** Its outward tables have been
hard-locked and auto-populated from GSTR-1 since the July 2025 period, so the
ERP's figures are for reconciliation, never as an authoritative input. Table 4
(ITC) needs purchase-side capture that does not exist yet — vendor invoice
number/date, an intra/inter split on PO lines, and GST columns on `expenses` —
so ITC still comes from the CA.


## Upload-driven reconciliation

Two sources, one shape, because a Zoho invoice register and a GSTR-2B download
are both "a list of documents each with a number, date, counterparty GSTIN,
taxable value and tax". They share `gst_recon_imports` + `gst_recon_lines`;
what differs is the match key, which lives in the matchers. Built on the
existing bank-recon pattern (`recon_sessions`/`bank_statements` plus
deterministic matchers in `lib/recon` with explicit tolerance constants)
rather than a second reconciliation concept.

**Zoho register (outward).** Answers: is anything we invoiced missing from what
GSTR-1 would report? That is the failure that matters most, because a missing
invoice is not rejected at the portal — it silently under-reports. Match key is
the document number, normalised by uppercasing and stripping every
non-alphanumeric. That is not tidiness: this data holds `DBI2026/27--00705`
with a double hyphen alongside correctly formed siblings, and a plain
`upper(trim())` would read it as a different invoice. The trailing sequence is
a secondary key, for when prefixes are formatted differently between systems.

**GSTR-2B (inward).** Match key is (supplier GSTIN, document number, date within
5 days) with a ₹2 tolerance — Zoho's implied key, stated explicitly with BUSY's
knobs instead of hidden. Only the B2B section is read; credit notes and
amendments are deliberately skipped because they net *against* credit, and
getting that wrong overstates ITC, which is the direction that attracts a
Rule 88D intimation.

The two "missing" buckets are opposite kinds of money:
- `missing_in_erp` — a supplier filed it and we never booked the purchase.
  Credit we are entitled to and not taking.
- `missing_in_source` — we hold a taxed purchase the supplier has not filed.
  Claiming that is what Rule 88D / DRC-01C polices.

Resolutions are **stored, not recomputed**, so next month starts from a known
baseline. An `itc_claimed`/`itc_ineligible` decision writes through to
`purchase_order_items.itc_status`, which is what makes it reach 3B Table 4 —
otherwise the reconciliation would change nothing.

## Filing state and the period lock

`gst_filings` records one row per entity x return type x period. **"filed" is a
local state transition only** — nothing here files at the portal, and clearing
it does not unfile there. The value is the frozen `snapshot`: without it an edit
made after filing is undetectable, and an amendment has nothing to diff against.
Marking a period filed while blockers stand is **refused**, not warned about.

`period_locks` blocks writes **by transaction date, not entry date**. That
distinction is the whole feature: entry-date locking still lets someone insert a
row dated inside a filed period. Per-module, and a partial unlock must carry a
reason (enforced in the database as well as the API). Deliberately decoupled
from filing status, as Zoho keeps transaction locking separate from its return
workflow — a filed period only *suggests* locking.

Enforced so far on the three writes that change a return: new sale
(`/api/sales-entry`), void, and invoice finalize. `lib/period-lock.ts` fails
open on an infrastructure error, because a lock is a bookkeeping guard and the
role checks are what actually protect the data.

## Credit notes

`invoices.invoice_type = 'credit_note'`, with its own number series
(`business_profiles.credit_note_prefix`, default `CN`) because a credit note is
a separate document nature in Table 13 — doc_num **5**, not 1 — and sharing the
invoice series would corrupt both ranges.

**Amounts are stored positive, exactly like an invoice.** This is the part most
easily got wrong. The portal wants positive values in `cdnr` and derives the
reduction itself, while Table 12, 3B 3.1(a)/3.2 and books-vs-return must be
**net**. So `v_gst_outward_lines` carries a `sign` (+1 invoice, −1 credit note)
and `txval_signed`/`camt_signed`/`samt_signed`/`iamt_signed`: netting consumers
read the signed columns, the CDNR section reads the raw ones. Storing negatives
instead would invert the cdnr output and understate the credit. A consumer that
forgets this does not fail loudly — it reports the credit note as *additional*
supply, which is how 3B initially over-reported by the credit amount before
being fixed.

One credit note per invoice (`credit_note_of_invoice_id`, 409 on a second).
A partial reversal is a smaller credit note, not a second one — two would
double-reduce the supply. On a partial, tax is re-derived from the credited
quantity rather than copied, so it cannot carry the full invoice's tax. The
number is minted only after every line validates, so a bad request never burns
a real credit-note number — the same rule the invoice path follows.

Owner-only, and it respects the period lock: issuing one into a locked period
is refused. This is the correct remedy for an invoiced sale that has to be
undone — voiding the sale alone leaves the invoice standing, which is exactly
what `/api/sales/[id]/void` warns about.

## Invoices are issued in Zoho, not here -- so Zoho is the authority on what's invoiced

This is a correction to how readiness used to work, not a cosmetic change.
Sales entry happens immediately on sale (per the "immediately real" business
rule), but **invoicing is deliberately deferred until payment is secured** --
an order can be cancelled, or paid weeks later, so a sale is entered on its
sold date and only gets a Zoho invoice once money has actually landed, dated
whenever that happens. That means "this sale has no `invoice_id` in the ERP"
was never a tax-compliance question; it only ever measured this system's own
recording backlog, because the ERP doesn't issue the invoice.

So `gst_sale_not_invoiced` is now a **warning**, not a blocker, and what
actually gates `can_generate` is `gst_zoho_register_status()`: has the Zoho
invoice register for this period been uploaded (covering the *whole* period --
a partial upload is rejected outright, since it would otherwise verify half a
month and look clean) and has every row been matched or explicitly resolved.
This is the real check, because it compares against what was actually issued
rather than against this system's own (incomplete) record of it.

One exception the warning text calls out: if a sale is marked `payment_status
= 'paid'` with no invoice, that is worth a second look even under this model --
the time of supply is the earlier of the invoice date or the date payment was
received (s.12/s.13), so once payment has landed the tax point has already
passed regardless of when the Zoho invoice gets dated.

## A sale that will never be invoiced

Some sales are deliberately not going to produce a tax invoice -- a sample, a
gift, a warranty replacement, a demo/internal-use unit. `sales.gst_exclusion_reason`
marks this; staff set it at entry (same "immediately real" posture as the sale
itself, via `/api/gst/exclusions` POST, which also accepts it inline on
`/api/sales-entry`), and the owner reviews it via `gst_exclusion_reviewed_at`
before the period is filed -- an exclusion removes value from the tax base, so
it should not pass unseen.

**This is not a free way to move stock.** A gift or free sample raises no
output tax (there is no consideration), but **s.17(5)(h) blocks the input
credit** on goods disposed of as a gift or free sample -- the credit claimed
when that unit was originally bought has to be reversed. `gift_itc_reversal_due`
raises this as a warning for every `sample`/`gift` exclusion; it is a judgement
on the *purchase* line so the check surfaces it rather than computing it.

An already-invoiced sale cannot be excluded (`already_invoiced`, 409) -- it is
already in a return, and the remedy there is a credit note, not a flag.

## Related

**sales-invoicing**, **purchasing**, **business-rules**.
