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
updated: 2026-10-12
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
- **Redirects** — old address → live page, permanent (308). Chains are flattened and loops rejected on save, so the
  storefront does one lookup. Changing a **published** product's web address creates one automatically
  (`PUT /api/sku-master/[id]`). The storefront consults redirects before returning 404 for a product, category-level
  (single-segment) path or blog post only.
- **Image alt text** — published products' photos with no alt text (edits go through the existing images route).
- **History** — the version before every change or removal; Restore puts it back (and the current version is kept, so
  a restore can be undone).

## Rules that matter

- Titles over 70 characters and descriptions over 200 are refused; over 60 / 160 only warn.
- Storefront reads degrade to "no override" on any error, so these tables can never break page rendering.
- Pages that read overrides are ISR (`revalidate = 60`), so a change shows within about a minute.
- A redirect never targets the home page as a source, and a product whose slug changes while unpublished gets none.

## Related

**website**, **settings-admin**, **backup-audit**.
