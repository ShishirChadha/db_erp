---
slug: publish-a-sku-to-website
title: Publishing a SKU to the website
kind: process
audience: [owner]
routes: [/dashboard/sku-master]
keywords: [publish, website, online, list on site, digitalbluez.com, web price, unpublish]
sources:
  - apps/erp/components/SkuWebPublishDialog.tsx
updated: 2026-08-29
---

## What this is

Making a SKU visible on the public storefront. Owner-only, opt-in, per SKU —
nothing is ever published automatically.

## Steps

1. From **SKU Master**, open the SKU's **Website** action.
2. Toggle **Published**, set web price/MRP (falls back to
   `selling_price_default` if left blank), slug, title, description,
   highlights, and condition grade.
3. Manage photos via the built-in photo manager (writes to `product_images` +
   the public storage bucket).
4. Save. `published_at` is set server-side on the publish transition — never
   client-supplied.

## What the website shows without any extra work

Availability is bucketed (never an exact count), the Test Report pulls
straight from `asset_qc_checks` (**qc-a-unit**), and RAM/SSD/warranty upgrade
options come from Settings → Website Admin — none of this needs re-entering
per SKU.

## Related

**website**, **inventory-sku**, **qc-a-unit**.
