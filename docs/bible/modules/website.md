---
slug: website
title: E-commerce Website (apps/web)
kind: module
audience: [owner, manager]
routes: [/dashboard/settings]
keywords: [website, online store, ecommerce, publish, digitalbluez.com, order, checkout, upgrade rules, promotion]
sources:
  - apps/web/lib/order-to-sale.ts
  - apps/erp/app/api/website-admin/**
updated: 2026-08-29
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
hardcoded), Promotions, Cross-sell rules.

## Related

**inventory-sku**, **sales-invoicing**, **finance-gst-reports**.
