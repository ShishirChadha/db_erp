---
slug: manage-cross-sell-rules
title: Setting up website cross-sell rules ("Complete your setup")
kind: process
module: website
audience: [owner]
routes: [/dashboard/settings]
keywords: [cross-sell, cross sell, complete your setup, suggested products, accessories suggestion, related products, upsell, category suggestion, saath mein]
sources:
  - apps/erp/components/WebsiteAdminManager.tsx
  - apps/erp/app/api/website-admin/cross-sell-rules/route.ts
  - apps/erp/app/api/website-admin/cross-sell-rules/[id]/route.ts
  - apps/web/lib/queries.ts
  - apps/web/app/product/[slug]/page.tsx
updated: 2026-09-16
---

## What this is

A simple owner-set mapping — "when a customer is viewing category X, suggest
category Y" — that drives the **"Complete your setup"** section shown near
the bottom of a product page on the website. It's an explicit merchandising
rule the owner configures, not a behavioral "customers also bought" engine —
the code's own comment in `apps/web/lib/queries.ts` notes the business
doesn't have the sales volume for a genuine collaborative-filtering claim to
be honest, so this stays a deliberate category→category mapping instead.

## Who can do this

Owner-only. Settings → Website Admin → Cross-sell tab.

## Steps

1. Open **Settings → Website Admin → Cross-sell**.
2. Enter **"When viewing category"** (the source category code, e.g. `LAP`)
   and **"Suggest category"** (the category code to recommend, e.g. `ACC`).
   Both are free-text category-code inputs, auto-uppercased.
3. Save. A duplicate `(source_category, suggested_category)` pair is rejected
   (409, "A rule for this category pair already exists").
4. Rules can be toggled active/inactive without deleting them, or deleted
   outright. There's no UI control for `sort_order` on this screen — every
   rule added through it defaults to `sort_order = 0`.
5. A single source category can have more than one active rule (e.g. `LAP` →
   `ACC` and `LAP` → `MON`) — all of them apply additively on the product
   page, not just the first match.

## What happens on the website

- On a product page load, `getCrossSellCategories(product.category)` reads
  the public `public_cross_sell_rules` view for that category (ordered by
  `sort_order`), returning the list of suggested category codes.
- Those categories feed `getPublishedProducts({ category: suggestedCategories,
  excludeId: product.id, limit: 4 })`, rendered under the **"Complete your
  setup"** heading via `ProductGrid`.
- Only **published** products (`is_published = true`) can appear here — if
  the suggested category currently has nothing published, `ProductGrid`
  renders nothing at all for that section (it returns `null` on an empty
  product list) rather than showing an empty heading.
- The system ships seeded with every category suggesting `ACC` (Accessories)
  by default — add more specific rules (e.g. Laptops → Adapters) as needed;
  they don't replace the default unless you also delete or deactivate it.

## Common mix-ups

- **"I added a rule but the section isn't showing on the site."** Confirm
  there's at least one **published** product in the suggested category —
  cross-sell only pulls from `public_products`, same publish gate as the rest
  of the storefront, unlike Marketing's stock browsing which is
  publish-independent (see **marketing** module).
- **"Multiple rules for the same source category — which one wins?"** None
  of them "win" — they're additive. All suggested categories from all active
  rules for that source category get combined into one candidate pool
  (subject to the 4-item limit).
- **"Deleting vs deactivating."** Deactivating hides a rule from the site
  without losing its configuration (still visible, dimmed, in the admin
  list); deleting removes it permanently.
- **"Does this affect Marketing's suggestions?"** No — this only drives the
  website's "Complete your setup" section. The Marketing Content Studio
  (`/dashboard/marketing`) has no concept of cross-sell rules; it works off
  its own category/brand/CPU filters over current stock.
