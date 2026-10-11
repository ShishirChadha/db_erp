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
  - apps/erp/app/api/sales-entry/route.ts
  - apps/erp/lib/sales-cart.ts
  - apps/erp/lib/gst-returns.ts
  - apps/erp/app/api/sales/[id]/route.ts
  - apps/erp/app/api/gst/void-numbers/route.ts
  - apps/erp/lib/pincode-state.ts
  - apps/erp/lib/recon/gst-pos.ts
  - apps/erp/lib/ai/structured.ts
  - apps/erp/app/api/gst/step-signoffs/route.ts
  - apps/erp/app/api/gst/news/route.ts
  - apps/erp/app/api/gst/news/run/route.ts
  - apps/erp/app/dashboard/gst/gst-news-panel.tsx
updated: 2026-10-12
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

### The page is a guided monthly checklist (since 2026-10-12)

`/dashboard/gst` is ten ordered steps, not a set of tabs -- the tab layout let a
blocker sit in a sub-tab nobody opened. Pick the month, then each step shows a
green / yellow / red tile computed by **one SQL function, `gst_period_steps()`**
(the single source of truth; the page, the filing API and a future auto-submit all
read it).

| # | Step | Red when | Yellow when |
|---|------|----------|-------------|
| 1 | Zoho register match | unresolved missing/mismatched amount or date | no register for the whole month; ERP invoices not in Zoho |
| 2 | Sales complete | voided sale with a live invoice | GST sales with no invoice and no sign-off |
| 3 | Invoice & customer checks | any tax/GSTIN/POS blocker, incl. `line_gst_rate_mismatch` | warnings not signed off |
| 4 | HSN & numbering | HSN, series-gap, duplicate/format blockers | `hsn_inconsistent_for_sku` not signed off |
| 5 | Zoho tax-head match | unresolved CGST/SGST/IGST or place-of-supply difference | no register, or upload predates the head comparison |
| 6 | Review & approve GSTR-1 | figures changed after filing | not approved / data changed since approval |
| 7 | File GSTR-1 & lock sales | figures changed after filing | approved but not filed, or filed but sales not locked |
| 8 | Purchases & ITC (GSTR-2B) | ITC marked claimed for a purchase not in 2B | no 2B upload, open lines, unsigned RCM warnings |
| 9 | Review & approve GSTR-3B | 3.1 does not tie to GSTR-1, or GSTR-1 changed after filing | GSTR-1 not filed yet, or not approved |
| 10 | File GSTR-3B | figures changed after filing | approved but not filed, or purchases not locked |

GSTR-1 (steps 1-7) is due the 11th, GSTR-3B (8-10) the 20th. Order is advisory
except for four gates: approving GSTR-1 needs steps 1-5 green (Zoho register first, since invoices originate there and its upload shows which "uninvoiced" sales already have an invoice); filing needs an
approval; approving 3B needs GSTR-1 *filed* (the portal builds 3B liability from
the filed GSTR-1) and step 8 green; filing 3B needs an approval.

**Sign-off** (steps 2, 3, 4, 8 only) is for warning-level items: owner + note +
a **fingerprint** of exactly the items reviewed (`gst_step_signoffs`). A new item
later changes the fingerprint, so the step returns to yellow with no extra
mechanism. A blocker can never be signed off. Uninvoiced sales are yellow, not red
(a decision): s.31 CGST requires the invoice at delivery rather than payment, so the
panel says so, but a sign-off with a reason (e.g. goods not yet delivered) is allowed.

**Approval is a content hash, not a button.** "Approve" (`gst_filings.status =
'exported'`) stores `snapshot_hash` = md5 of the GSTR-1 sections + HSN + docs
(`gst_gstr1_fingerprint()`) or of the 3B summary (`gst_gstr3b_fingerprint()`).
"Filed" is only accepted against an approval whose hash still matches the live data,
and requires the ARN. Drift **before** filing turns the step yellow (re-approve);
drift **after** filing turns it red (amendment territory). There is deliberately no
`force` flag. This is the hook for the later Zoho/GSP auto-submit: it can send only
what the owner approved, and refuses if anything moved.

**Tax heads are compared, not just the total.** The Zoho matcher
(`gst-zoho-matcher.ts`) compares CGST, SGST and IGST per invoice (±Rs 1) and place
of supply when the export has it (`gst-pos.ts` normalises "UP", "Uttar Pradesh",
"Uttar Pradesh (09)" ...). A same-total CGST+SGST-vs-IGST mix-up used to pass
silently; tax paid under the wrong head cannot be set off against the other and has
to be paid again and refunded separately. `gst_recon_imports.matcher_version` (2 =
heads compared) keeps step 5 yellow for an upload matched before this existed until
it is Re-checked. Zoho documents the owner ignored (e.g. a cancelled invoice) are
excluded from the head totals and shown separately.

**`line_gst_rate_mismatch`** (blocker, step 2) compares each invoice line's tax with
`rate x quantity x gst_rate`, with a Rs 1 tolerance per line (a percentage test
false-positives on tiny lines). Returns bucket lines by `gst_rate` (3B 3.1(a) takes
rate > 0, 3.1(c) nil/exempt takes rate = 0), so a line charging 18% with a stored rate
of 0 had its tax filed as nil/exempt -- found on DBI2026/27-00726, where it made 3B
3.1 understate tax by Rs 881.70 versus GSTR-1. The sale-edit sync
(`api/sales/[id]`) now sets `gst_rate` and derives inter-state from the invoice's
place of supply, not from the line's current IGST.

### Step 6 — Zoho GSTR-1 summary match (since 2026-10-12)

Step 6 has an **Upload Zoho Excel** box. Export Zoho's *Reports → Taxes → Summary of Outward Supplies* for the month as Excel and upload it. `POST /api/gst/zoho-gstr1` parses it with plain code (`lib/recon/zoho-gstr1-compare.ts`, SheetJS `xlsx`) — **no AI, nothing stored** — and compares it with `gst_r1_sections` / `gst_r1_hsn_summary` / `gst_r1_docs_issued`. It returns a section summary (B2B, B2C large/small, credit notes, HSN B2B/B2C, invoices issued) and a row-level "to fix" list: B2B invoices per number (missing on a side, GSTIN, place of supply, taxable; ₹2 rounding tolerance), B2C small by state+rate, HSN per code, and the Table 13 series. An invoice that Zoho files as B2B but the ERP files as B2C is named as a missing customer GSTIN. When the step-1 Zoho invoice CSV has been read with its item lines (the matcher keeps each line's `HSN/SAC`, item, quantity and price in `gst_recon_lines.raw.lines`, from 2026-10-13), the list compares **Zoho's lines against the ERP's per invoice** — Zoho HSN · amount beside ERP HSN · amount, flagging an invoice when any code's amount differs by more than ₹2 (an ERP line that has accessories sold inside it gets a **Split off** form per accessory — `POST /api/invoice-items/[id]/split`, owner-only, audited, refused for a filed or locked month — that moves an amount (pre-filled with what Zoho bills under that HSN) and its tax at the same rate into a new line under the accessory's HSN, leaving the invoice's taxable value, tax and total unchanged; the ERP stores only the combined price, so this is how a separately billed add-on is reproduced. After a split, editing the sale in the Sales Ledger re-syncs the unit line and does not know about the new line. It shows "includes: …" with each accessory's SKU HSN, since the ERP stores one combined price and Zoho may bill them apart) — so Zoho's real code is shown, not inferred. An older upload has no lines; step 6 then says to re-upload the CSV and falls back to the code-total inference. HSN differences are shown as a plain **list of invoices to check** (each with its lines and a "Change here" fold-out), not as HSN-code rows; the old per-code rows were replaced because Zoho's summary has no invoice numbers and the codes confused more than they helped. The list is built from the ERP invoices carrying each mismatched code, and suggest the code your own lookup gives — the item's SKU category default in Settings → SKU Categories (`sku_category_templates.default_hsn_code`) — so you decide per item whether to fix Zoho (then re-upload) or the ERP. Each ERP line has a **Set HSN** box (with "also the SKU" ticked by default) that calls `PATCH /api/invoice-items/[id]/hsn`: owner-only, audited (`field_corrections` + audit log), and refused for a filed or locked month. Line HSN is a snapshot taken from the SKU at invoicing, so editing the SKU alone never repairs existing lines; this is the supported path. The uploaded file and result are kept in `sessionStorage` per entity+month, and the page keeps entity, month and step in the URL so Back returns to the same place. It is a check, not a gate: it does not block approval.

### Invoice copy of customer GSTIN goes stale (guarded since 2026-10-12)

An invoice keeps its own copy of the customer's name and GSTIN (`invoices.customer_name/customer_gst`), and GSTR-1 reads that copy, not the live customer. Correcting a customer afterwards used to leave the invoice filed as B2C. Two guards, both limited to months that are **not** filed or locked: the trigger `trg_sync_invoice_customer_snapshot` on `customers` refreshes that customer's open-month invoices when GSTIN or name change, and the step-3 check `invoice_customer_gstin_stale` (blocker when the invoice has no GSTIN but the customer does, warning when they differ) offers a **Refresh from customer** button (`POST /api/gst/refresh-invoice-customer`). A filed or locked month is never changed.

### Bundled add-ons and non-slab rates (since 2026-10-13)

A free or token-priced item sold in one bundle with another item (a monitor "with" a desktop on one Zoho line) is **one supply, filed under the principal item's HSN and rate with no quantity of its own**; an item priced and sold separately keeps its own HSN. The ERP creates a separate invoice line for a bundled unit, so `invoice_items.bundled_into_item_id` marks it, and `v_gst_outward_lines` then reports the principal's HSN/rate and quantity 0 for it (taxable value and tax are unchanged, so section totals do not move). The owner sets it from step 6: each ERP line in the HSN rows has a **Bundle into…** select (`PATCH /api/invoice-items/[id]/bundle`, owner-only, audited, refused for a filed or locked month; **Unbundle** undoes it). New sales do not auto-bundle yet. Line `gst_rate` is snapped to the nearest standard slab when within 0.5 pt (`lib/gst-slabs.ts`; a ₹1 price gave 17.65%), and the blocker check `invalid_gst_slab_rate` (step 3) catches any line still off-slab, since the portal rejects it.

### Portal JSON: what is guarded, and finding a rejection (since 2026-10-13)

`buildGstr1Json` (`lib/gst-returns.ts`) writes the portal upload JSON in the shape the GST Offline Tool 3.2.4 itself writes (read from the tool's source): header `gstin, fp, version "GST3.2.4", hash "hash"`; Table 12 rows carry `user_desc` (ours) and `desc` (the portal's HSN-master description, from `lib/gst/hsn-master.json` via `POST /api/gst/hsn-descriptions`), `uqc` as the code only (`NOS`, `OTH`; services — codes starting `99` — use `NA` with quantity 0); Table 13 carries `doc_typ`. Before this, every upload was rejected with "File could not be uploaded". On the live portal the B2B upload then processed 22 of 25 invoices: the three it dropped (726, 736, 741) were exactly the ones whose lines had CGST and SGST a paisa or two apart, so `v_gst_outward_lines` now reports equal CGST/SGST on an intra-state line when they differ only by rounding (both = rate-based half-tax, within 5 paise), and `buildGstr1Json` leaves zero-value items out of the B2B tables (they stay in Table 12). The portal's message names no field, so step 6's working papers also offer **B2B / B2C small / HSN / Documents only** downloads to upload one table at a time. The ERP's JSON is unverified on the live portal until a retry succeeds — see `docs/current-progress.md`.

### GST news feed

A strip above the steps shows recent official GST updates. `gst_news_sources`
(owner-editable) are fetched daily by pg_cron `gst-news-fetch` (02:30 UTC = 08:00 IST)
-> `dispatch_gst_news()` -> `POST /api/gst/news/run` (auth: `x-cron-secret` checked
against `gst_news_config.dispatch_secret`, or an owner session via "Check now").
Claude lists genuine updates from each page against a business profile (UP-registered
regular filer; refurbished computers HSN 8471; rental SAC 997315; repair SAC 998713),
then reads each linked PDF and writes a specific summary, impact
(`action_required` / `review` / `info`), suggested ERP action and effective date.
Safeguards: the model may only cite URLs that literally appear in the fetched page; the
first read of a source is a baseline filed as *seen*; a source that returns no readable
text is recorded as `empty` (never silently quiet); every card says "AI summary --
verify against the official notice"; it distinguishes a Council *recommendation* from a
notified change. `action_required` notifies the owner (`gst_news`). The GST Portal's
own News & Updates page is a JavaScript app that returns nothing to a server fetch, so
it is seeded **inactive** until a working feed is found. The cron needs
`gst_news_config.dispatch_url`/`dispatch_secret` set once, or it no-ops (like the digest
job).

### Security note

The GST tables (`gst_filings`, `gst_recon_*`, `gst_void_invoice_numbers`,
`period_locks`, sign-offs, news) are service-role-only: RLS is **on with no
policies**. They were created with Supabase's default grants (anon/authenticated get
full DML) and RLS off, which let the public anon key read and write customer names,
GSTINs, invoice numbers and amounts through PostgREST (found and fixed 2026-10-12).
Every route uses `supabaseAdmin`, so nothing changed for the app. Any new table
needs `enable row level security` in its own migration.

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

**A CSV row is not always an invoice.** Some Zoho exports are line-item level
(one row per invoice *line*, not per invoice), so a multi-line invoice
produces several rows sharing a document number before matching even starts.
`matchZohoInvoices()` groups those rows by normalised doc number first. The
two totals-shaped columns and the four tax columns behave oppositely on a
grouped row, confirmed against a real multi-line invoice PDF
(`DBI2026/27-00731`): SubTotal/Total are **invoice-level figures repeated
identically on every line** — summing them multiplies the total by the line
count — while CGST/SGST/IGST/Cess are genuinely **per-line** and must be
summed, or only one line's tax gets reported as the whole invoice's. Getting
either half wrong reads as a real mismatch that doesn't exist.

**Resolving a row (Resolve rows / Ignore) requires a typed reason**
(`resolution_note`, shown under the row and kept for audit) — `PATCH
/api/gst/recon` rejects setting a `resolution` without one. A resolution is
reversible: clicking the resolved badge calls the same PATCH with
`resolution: null`, no reason needed to undo. "Ignored" doesn't mean excluded
from GSTR-1 — it only clears the row from the reconciliation's open-problems
list; the underlying invoice is still reported normally. The "Problems" count
on `gst_recon_imports` (`mismatch_count`/`missing_in_erp_count`/
`missing_in_source_count`, kept in sync by the `sync_gst_recon_counts()`
trigger) only counts rows with `resolution is null` — a resolved/ignored row
stops counting as a problem without needing to be deleted.

**Re-checking one import** (`POST /api/gst/recon` with `source_import_id`
instead of a new `content` upload) re-runs the matcher against that import's
own already-normalised lines — not the original raw CSV — and updates the
same `gst_recon_imports` row in place rather than creating a new one. Both
Recheck and a plain re-upload for the same entity/period/kind carry forward
any prior resolution whose `match_status` hasn't changed, keyed by doc
number, so fixing an invoice and refreshing doesn't wipe out every Ignore
decision made so far — only rows whose verdict actually changed lose their
old resolution, which is correct (a mismatch that's now fixed should surface
again if it reappears for a different reason).

## A series gap that was genuinely cancelled outside the ERP

`doc_series_gap` (a missing number inside a series, Document Summary tab)
used to have no resolution path at all -- unlike `gst_recon_lines`, which can
be Resolved/Ignored, a gap just sat there forever even when it was a real,
known case: a number Zoho raised and then cancelled before it ever got a row
in the ERP, not even a soft-deleted one. **Mark cancelled (Zoho)** on that
row (owner-only, requires a typed reason, same pattern as Resolve/Ignore)
calls `gst_acknowledge_series_gap()`, which writes to
`gst_void_invoice_numbers` and:
- excludes that exact `(series_key, seq)` from `v_gst_exceptions` going
  forward, clearing the blocker, and
- folds it into `gst_r1_docs_issued()`'s `cancel`/`totnum` counts for Table
  13, so the number is reported as **cancelled**, not silently omitted —
  omitting it would under-count `totnum` for that series and make Table 13
  unreconcilable against the numbers actually consumed.

It is reversible (`DELETE /api/gst/void-numbers?id=`), same as Resolve/Ignore.
`period_month` is computed once at acknowledgment time using the same "month
of the preceding invoice in this series" rule `series_gaps` already applies
when first surfacing the gap — not recomputed on every read.

This is distinct from a `voided_sale_with_live_invoice` blocker: that one is
for a sale void where the ERP's own invoice is still live (needs a credit
note). `doc_series_gap` is for a number the ERP never held an invoice row
for at all.

## Filing state and the period lock

`gst_filings` records one row per entity x return type x period. **"filed" is a
local state transition only** — nothing here files at the portal, and clearing
it does not unfile there. The value is the frozen `snapshot`: without it an edit
made after filing is undetectable, and an amendment has nothing to diff against.
For GSTR-1 and GSTR-3B, `exported` is the owner's **approval** (steps green, figures
frozen with `snapshot_hash`) and `filed` is refused unless it follows an approval whose
hash still matches the live data, with the ARN entered -- see the guided-checklist
section above. (Before 2026-10-12 this only checked the blocker count and had a
`force` bypass; both are gone.) GSTR-1A / GSTR-9 keep the plain rule: no blockers.

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

## Invoices are issued in Zoho, not here -- a sold entry is out of scope until one exists

This is the current model, after a correction on 2026-10-05 (see
docs/decisions.md for the full reasoning and what it replaced). Sales entry
happens immediately on sale (per the "immediately real" business rule), but
**invoicing is deliberately deferred until payment is secured** -- an order
can be cancelled, or paid weeks later, so a sale is entered on its sold date
and only gets a Zoho invoice once money has actually landed, dated whenever
that happens.

**A sold entry with no invoice -- Zoho-recorded or ERP-issued -- is simply out
of scope of GST filing.** There is no per-sale categorisation inside the GST
module for *why* something isn't invoiced yet (an earlier `gst_exclusion_reason`
flag for samples/gifts/warranty replacements was built and then removed --
zero production rows ever used it). `gst_sale_not_invoiced` is a **neutral,
zero-severity count** in `gst_return_readiness()`'s `completeness` block --
visible, but not a blocker or a warning, and not part of `can_generate`.

Protection against under-reporting is **the Zoho invoice register**
(`gst_zoho_register_status()`, guided steps 4-5): has the register for this period
been uploaded (covering the *whole* period -- a partial upload is rejected outright)
and has every row been matched or explicitly resolved. A partial check must never
silently pass as complete.

A second safety net, **bank-credit reconciliation** (money that arrived with no sale
and no Zoho invoice), existed from 2026-10-05 and was **removed from the GST module
on 2026-10-12** -- the owner judged it too complex for now (`gst_bank_credit_status()`
and its two exception checks are dropped). The Bank Reconciliation module itself is
untouched and can be re-attached later as a guided step.

## Related

**sales-invoicing**, **purchasing**, **business-rules**.
