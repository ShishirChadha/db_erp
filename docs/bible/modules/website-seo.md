---
slug: website-seo
title: Website SEO (Settings → Website SEO)
kind: module
audience: [owner]
routes: [/dashboard/settings]
keywords: [seo, search, google, redirect, redirects, metadata, title, description, noindex, alt text, sitemap, canonical, slug]
sources:
  - apps/erp/components/WebsiteSeoManager.tsx
  - apps/erp/lib/seo-admin.ts
  - apps/erp/app/api/website-seo/overrides/route.ts
  - apps/erp/app/api/website-seo/redirects/route.ts
  - apps/erp/app/api/website-seo/settings/route.ts
  - apps/erp/app/api/website-seo/revisions/route.ts
  - apps/web/lib/seo-data.ts
  - apps/web/lib/collections.ts
  - apps/web/app/api/seo/404/route.ts
  - apps/erp/lib/seo-crawl.ts
  - apps/erp/components/WebsiteSeoData.tsx
  - apps/erp/app/api/website-seo/keywords/route.ts
  - apps/erp/app/api/website-seo/crawl/route.ts
  - apps/web/app/feeds/google.xml/route.ts
  - apps/web/app/contact/page.tsx
  - apps/erp/app/api/website-seo/collections/route.ts
  - apps/erp/app/api/website-seo/images/bulk-fill/route.ts
  - apps/erp/components/MasterDetail.tsx
  - apps/erp/components/CompetitorsSection.tsx
  - apps/erp/components/SuggestionsSection.tsx
  - apps/erp/lib/net-guard.ts
  - apps/erp/lib/seo-competitor.ts
  - apps/erp/lib/seo-competitor-ideas.ts
  - apps/erp/lib/seo-suggestions.ts
  - apps/erp/app/api/website-seo/competitors/route.ts
  - apps/erp/app/api/website-seo/suggestions/route.ts
updated: 2026-10-16
---

## What it is

An owner-only Settings tab for how the public website appears in search. Everything is stored in four tables
(`seo_settings`, `seo_overrides`, `seo_redirects`, `seo_revisions`, migration `20261015`) that the storefront reads
through the `public_seo_settings`, `public_seo_overrides` and `public_redirects` views. The tables themselves are
service-role only; employees get 403 from every `/api/website-seo/*` route, and the `website` page grant does **not**
unlock any of it.

## How the screens are laid out

Settings → Website SEO is a **vertical section menu on the left and the selected screen on the right**, with no horizontal tabs and
no sideways-scrolling tables. Screens that manage records (Page metadata, Collections, Keywords, Redirects, Competitor websites,
Suggestions, History) repeat the pattern one level down: a list of records, then the editor for the one you pick. On a phone one
pane shows at a time with a Back button. All of it is `components/MasterDetail.tsx`, the same pattern as Activities and Stock.

## The tabs

- **Overview** — counts of what still needs attention (published products without a description, photos without alt text).
- **Site defaults** — the description used when a page has none, the product-description template
  (`{title} {brand} {model} {price}`), and the default share image.
- **Page metadata** — a search title/description, an index/noindex choice and a canonical for one page: a fixed page
  (home, about, policies…), a category, a single product (keyed by SKU id so it survives a slug change) or a blog post.
  **Draft** rows are stored but never reach the website; only **Published** rows do. This is how a policy page is made
  indexable once its text is real (the pages ship `noindex` until then).
- **Collections** — owner-written pages for a saved filter, e.g. `/laptops/dell` or `/laptops/under-20000` (laptops and
  desktops only). Each has a name, heading, search title/description, a Markdown intro, optional questions and the filter
  (brand, CPU, RAM, SSD, graphics, price range — the same matching code as the storefront's own filters, shared via
  `@db/shared`). A **published** collection is always reachable, but it is only *indexable* — `index,follow`, in the sitemap,
  linked as "Shop by" on its category page — while it has at least `min_products` **available** (not sold-out) products
  **and** at least `min_intro_words` words of intro (defaults 3 and 120; the owner sets them per collection — they are
  quality heuristics, not Google thresholds). Otherwise it is `noindex,follow`. Draft collections and collections matching
  nothing at all are a 404. The list shows live counts and exactly what is blocking indexing. Two collections with the same
  filter are refused; renaming a published one adds a redirect, and deleting one redirects to its category (never the home page).
- **Keywords** — the keyword → target-page map (cluster, intent, area, priority). Numbers are stored **only** with a named
  source: import a Search Console Queries export (clicks, impressions, position), a Keyword Planner download or a Trends
  CSV, choosing where it came from and its date; the database refuses a search volume without a source, so nothing is
  estimated. A cluster aimed at more than one page is flagged as possible overlap. Export returns everything as CSV.
- **Crawl & 404s** — upload a Screaming Frog *Internal → All* CSV (steps are on the tab). Only HTML pages are kept (the
  newest 3 uploads are retained) and problems are derived on demand by `lib/seo-crawl.ts`: broken/redirecting/slow
  pages, missing or long titles/descriptions/H1s, duplicates, thin pages, and a comparison with the **live sitemap**
  (listed but not 200, not indexable, never found, orphaned). Below it, a log of addresses that showed the 404 page, recorded
  from visitors' browsers (`POST /api/seo/404` → `log_404()`; capped at 5,000 distinct paths, assets ignored). Crawlers
  that don't run scripts won't appear there — Search Console's Pages report covers those.
- **Suggestions** — what to do next, built from measurements taken when you open it (the live home page, your stock,
  collections, dead links, crawl and keyword data, competitor analyses), most urgent first. Each item says why it matters and the
  exact steps, and can be marked done, snoozed or dismissed (a done item is re-checked after 14 days and returns if the problem is
  still there). It also carries the **Google Business Profile routine**: weekly (post new arrivals, reply to reviews), monthly
  (photos, hours, services, performance numbers) and quarterly (category and attributes, name-address-phone consistency, a tagged
  website link). Those are reminders only, because Google doesn't let this tool read or edit a Business Profile. A pg_cron job
  (`scan_seo_review`, Mondays 09:30 IST) raises one Activities task per active owner pointing here; it skips a week while the
  previous task is still open.
- **Google setup** — live checks (is Analytics installed and is its ID the right shape — `G-` plus 10 characters; is a Search
  Console verification (meta tag, or the HTML verification file served from the storefront's `public/` folder, or DNS); is the sitemap readable; are the ERP's Google reports connected) and the numbered
  steps for Analytics, Search Console (as a Domain property verified by DNS), connecting reports to the ERP, Business Profile,
  Merchant Center and optional extras.
- **Competitor websites** — list public sites (preloaded: EazyPC, Edify, NewJaisa, Electronics Bazaar, plus our own site as the
  baseline) and press **Analyse**. The server reads robots.txt, the sitemap, the home page and one sample product, collection,
  policy and blog page (at most ~14 requests, honouring robots.txt, once an hour per site) and stores only signals: titles and
  lengths, markup types and product-markup fields, menu structure (price bands, brands, uses), policy pages, selling points they
  state, sitemap counts. Ideas compare each site with ours and say where to apply them; they never suggest copying text. Outbound
  fetching is guarded (`lib/net-guard.ts`): https only, no private/internal addresses, same-site redirects only, timeout and size
  caps.
- **Redirects** — old address → live page, permanent (308). Chains are flattened and loops rejected on save, so the
  storefront does one lookup. Changing a **published** product's web address creates one automatically
  (`PUT /api/sku-master/[id]`). The storefront consults redirects before returning 404 for a product, category-level
  (single-segment) path or blog post only.
- **Image alt text** — published products' photos with no alt text (edits go through the existing images route).
  **Fill all missing with a default** gives each one "product name - photo N of M" and never overwrites existing text.
- **History** — the version before every change or removal; Restore puts it back (and the current version is kept, so
  a restore can be undone).

## Google Merchant Center feed

`https://www.digitalbluez.com/feeds/google.xml` is a standard product feed (refreshed hourly) for Merchant Center's
**Scheduled fetch** — no API access is needed to use it. It lists only **in-stock laptops, desktops, monitors and tablets**,
all as `condition: refurbished`. Left out on purpose: accessories (the ERP doesn't record whether a cable or UPS is new
or used, and the feed requires a condition), sold-out items, any sale/MRP price, and GTIN/MPN (`identifier_exists: no`).
Shipping and return policies are not in the feed; set them in the Merchant Center account once the real policies exist.
The `/contact` page carries `ComputerStore` markup with only verified facts: name, address, phone, email, links and the
opening hours (every day, 9 AM–8 PM, confirmed by the owner 2026-10-13). Coordinates and ratings are intentionally absent.

## Rules that matter

- Titles over 70 characters and descriptions over 200 are refused; over 60 / 160 only warn.
- Storefront reads degrade to "no override" on any error, so these tables can never break page rendering.
- Pages that read overrides are ISR (`revalidate = 60`), so a change shows within about a minute.
- A redirect never targets the home page as a source, and a product whose slug changes while unpublished gets none.

## Related

**website**, **settings-admin**, **backup-audit**.

## Adding a competitor that cannot be read

When a competitor is added (Competitor websites, or Price Board → Competitors) the site is tested first. If it blocks automated readers (bot check), forbids us in robots.txt, or has no readable price list, you are warned and must confirm with **Add anyway**; the SEO page analysis can still work on it but the Price Board will not show its prices. Electronics Bazaar was removed for this reason.
