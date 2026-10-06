---
slug: website
title: E-commerce Website (apps/web)
kind: module
audience: [owner, manager]
routes: [/dashboard/settings]
keywords: [website, online store, ecommerce, publish, digitalbluez.com, order, checkout, upgrade rules, promotion]
sources:
  - apps/web/lib/order-to-sale.ts
  - apps/web/lib/product-title.ts
  - apps/web/app/api/search/route.ts
  - apps/erp/app/api/website-admin/**
updated: 2026-10-06
---

## The ERP is the single source of truth — the website never gets a copy

`apps/web` reads through Postgres views (`public_products`,
`public_product_images`, `public_categories`, etc.) that select only
publish-safe columns — cost/vendor/margin fields are never selected by these
views at all, so there's no redaction-in-app-code risk here the way
`lib/auth/redact.ts` has for staff routes.

## Publishing is owner-curated and opt-in, per SKU

Via the "Website" action on SKU Master (`SkuWebPublishDialog`, owner-only) —
`is_published` defaults `false`; a SKU is invisible on the site until flipped.

## An online order is just another sales channel into the ERP

Checkout re-prices from the public view server-side (never trusts the client
cart), reserves inventory atomically before payment (`reserve_order_items`,
15-minute TTL), and on Razorpay webhook success converts each order item into
a real `sales` row — same stock-decrement trigger, `sold_by = 'Website'`,
`payment_account = 'Digitalbluez'`, `entered_by = NULL` (no staff entered it).

## Configuration lives in Settings → Website Admin (owner-only)

Upgrade pricing (RAM/SSD/warranty upsells — always admin-configured, never
hardcoded), Promotions, Cross-sell rules, Banners, Blog.

## Product display titles go through one helper

`apps/web/lib/product-title.ts`'s `productDisplayTitle()` is the single place
every storefront surface gets a product's display name from — card, PDP
(h1/breadcrumb/metadata/JSON-LD), search, cart, checkout, and
`order_items.title_snapshot`. It prefixes **"Certified Refurbished"** for
laptops/desktops/monitors/tablets (skipped if `web_title` already says
"refurb", since the owner-curated title often does), and falls back through
`web_title` → config summary → brand+model, same as before. Deliberately
*not* applied to GA4 `item_name` (keeps historical analytics comparable) or
to invoices (a tax document, not a marketing surface).

## Search: products, then blog, then related — in that order

`GET /api/search` backs the header suggestion panel and `/search`. Always
returns up to 6 product matches. Only when there are fewer than 3 does it
fill a second column: blog posts matching the term first, falling back to
"You might also like" (same cross-sell category mapping as "Complete your
setup" on the product page) if no blog post matches either — so the panel
is never just a short, lonely list. `sku_master.web_title` has a `pg_trgm`
index (`idx_sku_master_web_title_trgm`, added 2026-10-06) since it's the
main field actually searched — `brand`/`model_name`/`full_sku_code`/
`sku_description` already had one, this was the one gap.

## The blog is real, but needed an editor

`blog_posts`, `/blog`, `/blog/[slug]`, their JSON-LD and sitemap entries all
existed already — authoring did not, which is why the table sat at 0 rows.
Settings → Website Admin → Blog (owner-only) is a plain create/edit/publish
screen (`BlogSection` in `WebsiteAdminManager.tsx`, `POST`/`PATCH`/`DELETE
/api/website-admin/blog-posts`). `published_at` is set once, server-side, on
the actual draft→published transition — same convention as
`sku_master.published_at`.

## Listings: in-stock filter and sort, everywhere

`availability_bucket` (computed on `public_products`) used to be display-only
— sold-out items appeared in every listing and search result with no way to
hide them. Every listing/search page now has an "In stock only" toggle and a
Sort control (Featured/Newest/Price asc/desc). The two filterable categories
(Laptops/Desktops) apply it in-memory alongside their existing spec facets;
everywhere else it's real SQL (`.neq('availability_bucket','sold_out')`,
`.order()`) via `getPublishedProductsPage()`.

## Product photos are never cropped

A photo that isn't square used to get **cropped** by `object-cover` — the
upload pipeline itself was always correct (`fit:'inside'`, aspect-preserving;
`apps/web` runs with `images.unoptimized: true`, so nothing resizes server-
side at view time either). The product detail gallery now sizes its
container to the photo's own stored `width`/`height`; cards, thumbnails and
search rows use `object-contain` on a muted background instead, so nothing
is ever cut off, at the cost of letterboxing on a non-square photo in the
fixed-size slots. The downloadable WhatsApp/Instagram marketing cards
(`apps/erp/lib/marketing/card-templates.tsx`) are a *different*, later,
deliberately-cropping surface (2026-09-19) — not touched by this, and not a
regression of anything.

## Related

**inventory-sku**, **sales-invoicing**, **finance-gst-reports**,
**system-health** (the `pg_trgm` index convention).
