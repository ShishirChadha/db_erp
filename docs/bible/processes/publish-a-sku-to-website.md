---
slug: publish-a-sku-to-website
title: Publishing a SKU to the website
kind: process
audience: [owner]
module: website
routes: [/dashboard/sku-master]
keywords: [publish, website, online, list on site, digitalbluez.com, web price, unpublish]
sources:
  - apps/erp/components/SkuWebPublishDialog.tsx
updated: 2026-10-16
---

## What this is

Making a SKU visible on the public storefront. Owner-only, opt-in, per SKU —
nothing is ever published automatically.

## Steps

1. From **SKU Master**, open the SKU's **Website** action.
2. Toggle **Published**, set web price/MRP (saving a price sets the default
   selling price to the same number; to reprice many laptops at once use the
   **Price Board**, see **use-the-price-board**), slug, title, description,
   highlights, and condition grade.
3. Manage photos via the built-in photo manager (writes to `product_images` +
   the public storage bucket).
4. Save. `published_at` is set server-side on the publish transition — never
   client-supplied.

The default **title** pre-filled in the dialog leaves out "No" / "N/A" spec values (the storefront also strips them
from titles already saved). Changing the **web address (slug)** of a *published* product automatically adds a permanent
redirect from the old address, so it keeps working — see **website-seo**.

## What the website shows without any extra work

Availability is bucketed (never an exact count), the Test Report pulls
straight from `asset_qc_checks` (**qc-a-unit**), and RAM/SSD/warranty upgrade
options come from Settings → Website Admin — none of this needs re-entering
per SKU.

## Related

**website**, **inventory-sku**, **qc-a-unit**.

## Photo uploads are shrunk in your browser first

Since 2026-10-01 an image is resized and re-encoded in the browser before it is
uploaded (longest side 1600px), then the server resizes and converts it to webp
as it always did.

This exists because the upload has to survive the trip at all: Vercel caps a
request body at 4.5MB and a raw phone photo is routinely larger, so the file
arrived truncated and the server reported "premature end of JPEG image". The
browser step also repairs a source whose own JPEG data is incomplete, because
it decodes what is there and re-encodes a well-formed image.

Nothing changes in how you use it -- pick a photo as before. Large photos simply
upload faster now.

## The photo manager's preview no longer crops

Before 2026-10-06 a non-square photo looked cropped here too, in the little
square preview thumbnail — this was display only (`object-cover`); the actual
uploaded file was never touched. The preview now letterboxes the whole photo
instead, matching what the storefront itself shows, so what you see here is
what customers will see.
