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
updated: 2026-10-13
---

## What it is

An owner-only Settings tab for how the public website appears in search. Everything is stored in four tables
(`seo_settings`, `seo_overrides`, `seo_redirects`, `seo_revisions`, migration `20261015`) that the storefront reads
through the `public_seo_settings`, `public_seo_overrides` and `public_redirects` views. The tables themselves are
service-role only; employees get 403 from every `/api/website-seo/*` route, and the `website` page grant does **not**
unlock any of it.

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
