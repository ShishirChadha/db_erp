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
  - apps/web/app/api/checkout/start/route.ts
  - apps/web/lib/customer-identity.ts
  - apps/web/lib/email.ts
  - apps/erp/app/api/website-admin/**
  - apps/erp/app/api/web-orders/**
updated: 2026-10-13
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

## Checkout: no account required, and the price depends on how you pay

**Guest checkout (2026-10-06).** No account is required to place an order.
The guest's cart is carried in the request body (localStorage lines,
re-validated server-side exactly like `/api/cart/merge`) rather than read
from a server-side `cart_items` row. `orders.customer_id` is nullable;
`orders.guest_contact` (name/phone/email) holds what was entered at
checkout. **The CRM `customers` row is created or matched only once payment
actually succeeds**, in the webhook — never at add-to-cart or checkout —
reusing the exact phone-dedupe logic `/api/auth/signup` already has
(`findOrCreateCustomerByPhone`, extracted so neither copy can drift). This
is the direct answer to the reason anonymous Supabase auth is rejected
elsewhere (`apps/web/lib/guest-cart.ts`): a bot or an abandoned guest
checkout costs nothing, because nothing is written until money lands. A
real login account is then created best-effort (never fatal to the sale)
and the order retroactively linked to it, and emailed a "set your password"
link via Resend (`apps/web/lib/email.ts` + `email-templates.ts`, same thin
REST wrapper `apps/erp/lib/email.ts` already uses — duplicated rather than
shared since the two apps are separately deployed with separate env/Vercel
projects; apps/erp having `RESEND_API_KEY` does nothing for apps/web until
it's set there too, 2026-10-06). `/api/auth/signup`'s own confirmation
email is unaffected — it still auto-confirms (`email_confirm: true`), a
separate decision from whether Resend is configured.

**Payment-method pricing.** `website_payment_settings` (Settings → Website
Admin → Payments, owner-editable, never hardcoded) holds a discount % for
UPI/card and a handling fee % for Cash on Delivery — **a discount, not a
surcharge**: a UPI surcharge is specifically illegal in India (Payment &
Settlement Systems Act s.10A) and card surcharging breaches network rules,
while a discount for paying the full amount up front is legal on every
method and has identical economics. The adjustment is baked straight into
`order_items.unit_price` (never left only in a display column), same rule
as the existing promo `discount_amount`.

**Cash on Delivery collects a token now, the rest later.** Razorpay only
ever charges `min(website_payment_settings.cod_token_amount, order total)`
up front — stored on the order as `token_amount` so a later settings change
can't retroactively change what a specific order is understood to have
collected. The balance is cash collected at delivery, recorded from the
ERP's **Web Orders → "Mark delivered + record balance"** action (owner-only),
which ledgers a real `sale_payments` row — allocated across however many
`sales` rows the order produced via `allocatePaymentLegs` (in
`packages/shared`, not duplicated in `apps/erp/lib/sales-cart.ts`, which
re-exports it) — rather than ever writing `amount_paid` directly. `orders`
gains `'partially_paid'` (token received, balance owed) alongside `paid`,
and a new `fulfillment_status` (`pending → packed → shipped → delivered →
returned`) that didn't exist in the schema at all before this.

**The bug this depended on getting right first:** `order-to-sale.ts` used to
write `sales.amount_paid`/`payment_status` directly on insert instead of
through `sale_payments`. Harmless while every order was paid in full in one
shot — but the trigger that derives both (`sync_sale_payment_totals`) recomputes
them as `sum(sale_payments)` with zero awareness of a value set directly on
the row, so the first COD balance payment would have silently erased the
token payment. Fixed and verified standalone (see `docs/decisions.md`,
2026-10-06) before building anything else on top of it.

## Configuration lives in Settings → Website Admin (owner-only)

Upgrade pricing (RAM/SSD/warranty upsells — always admin-configured, never
hardcoded), Promotions, Cross-sell rules, Banners, Blog, Payments.

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

Customer-facing titles, alt text and JSON-LD drop placeholder spec values ("No", "N/A") via `@db/shared`'s `placeholder-values.ts`, and the helper also cleans an older stored `web_title` that was auto-filled with them. Accessories are never labelled "Certified Refurbished" or marked `RefurbishedCondition` in JSON-LD; only LAP/DES/MON/TAB are.

The sitemap (`apps/web/app/sitemap.ts`) lists only categories that have a mapped slug in `lib/categories.ts` and at least one published product, and includes `/blog` only once a post exists. Cart, checkout, login, signup, account and order pages are `noindex`.

## Forgotten passwords

Customers reset a password at `/forgot-password`. `POST /api/auth/forgot-password` always answers the same way (so it can't
reveal who has an account) and emails a recovery link through Resend, so email only works once `RESEND_API_KEY` and
`RESEND_FROM_EMAIL` are set in apps/web. The link is generated server-side, so it also works on a different device. GoTrue
sends it back to its configured site URL (the apex domain; `/reset-password` is not on its redirect allow-list), so
`components/RecoveryRedirect.tsx` forwards any page that receives a `type=recovery` hash to `/reset-password`, where the
customer picks a new password. The guest-checkout "set your password" email uses the same link.

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

Post bodies are rendered as Markdown by `apps/web/lib/markdown.tsx` (headings, lists, bold/italic, quotes, links, images). It
builds React elements rather than HTML strings and only allows https:, mailto: and site-relative URLs, so a post can
link to products and categories but cannot inject script. Plain-text posts written before this still render the same.
The `BlogPosting` markup includes `dateModified`, `mainEntityOfPage` and a publisher.

## Listings: in-stock filter and sort, everywhere

`availability_bucket` (computed on `public_products`) used to be display-only
— sold-out items appeared in every listing and search result with no way to
hide them. Every listing/search page now has an "In stock only" toggle and a
Sort control (Featured/Newest/Price asc/desc). The two filterable categories
(Laptops/Desktops) apply it in-memory alongside their existing spec facets;
everywhere else it's real SQL (`.neq('availability_bucket','sold_out')`,
`.order()`) via `getPublishedProductsPage()`.

## Customer policies (owner-approved 2026-10-13)

Three customer-facing policy pages are live and indexable: **Warranty** (`/warranty`), **Replacement** (`/replacement-policy`)
and **Shipping & Delivery** (`/shipping-policy`). Privacy and Terms are still drafts (noindex). The terms, in short:

- **Warranty:** 6 months on every laptop, desktop, monitor and tablet, from delivery; accessories keep the warranty on their
  own product page. Excluded: physical/liquid damage, motherboard/CPU/GPU damage from shorting, third-party repair,
  software/data loss, normal battery ageing. Remedy: repair, else equal-or-better replacement, else refund. The customer pays to
  send the unit in; DigitalBluez pays the return of the repaired/replacement unit. Walk-in service at the store is free.
  The storefront shows "6 Months" for any computer SKU with no label (`effectiveWarrantyLabel`, applied once in
  `lib/queries.ts`), so nothing needs back-filling in the ERP.
- **No change-of-mind returns.** Replacements only: dead/damaged/wrong on arrival (report within 48 hours with an unboxing video)
  or a hardware defect within 7 days; refund to the original payment method within 7 working days only when a replacement
  isn't possible (Indian e-commerce rules don't let a seller refuse a refund for a defective or misdescribed item). DigitalBluez
  pays the courier for the replacement and for collecting arrival problems; the customer pays to send back a defect found
  within 7 days.
- **Shipping:** dispatch within 3–6 business days; delivery per the courier; free on orders that include a laptop, desktop,
  monitor or tablet. Cash on delivery terms are read live from the checkout settings, so the page can't disagree with checkout.
  Accessory-only orders are intended to carry a location-based shipping charge (₹250 Noida/Greater Noida, ₹350
  Delhi/Gurgaon/Faridabad, ₹500 elsewhere) — **not built yet** (needs a checkout and GST-invoice change), so the page says
  nothing about it until it is.
- **Grievance Officer:** named in the footer and on the replacement policy (`GRIEVANCE_OFFICER` in `lib/business-info.ts`).

The storefront no longer shows a struck-through MRP or "% off" (no stored market price has a documented source), and the
home page's "Best deals" row, which depended on it, is gone. The per-product **buyback guarantee amount** was replaced by a
"Trade in your old laptop — get a quote on WhatsApp" prompt; `/buyback` is now a plain trade-in page with no fixed percentage.

## How product photos are resized

Photos are re-encoded to webp at upload time in the ERP, and the storefront serves each one at the size the page needs
through `apps/web/lib/image-loader.ts`, a custom `next/image` loader that points at the self-hosted storage's render
endpoint (`/storage/v1/render/image/public/...?width=`). Cloudflare caches every size. This deliberately does **not**
use Vercel's Image Optimization, whose free quota ran out twice (`docs/decisions.md`, 2026-09-28).

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
