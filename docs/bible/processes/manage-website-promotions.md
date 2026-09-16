---
slug: manage-website-promotions
title: Setting up website promotions (discounts, coupons, free gifts)
kind: process
module: website
audience: [owner]
routes: [/dashboard/settings]
keywords: [promotion, promotions, discount, coupon, coupon code, sale, offer, free gift, percent off, flat off, sitewide, festive sale, chhoot, discount code, promo code]
sources:
  - apps/erp/components/WebsiteAdminManager.tsx
  - apps/erp/app/api/website-admin/promotions/route.ts
  - apps/erp/app/api/website-admin/promotions/[id]/route.ts
  - apps/web/lib/promotions.ts
  - apps/web/app/api/checkout/start/route.ts
updated: 2026-09-16
---

## What this is

Discounts, coupon codes, and free-gift offers applied at website checkout —
configured in Settings → Website Admin → Promotions, never hardcoded in
`apps/web`. Four `promo_type`s: **% off**, **flat ₹ off**, **free gift**, and
**coupon code** (a bare `coupon_code` promo carries no discount of its own —
its only job is to require the customer type an exact code before *another*
promo's `code` field will match; see **What happens at checkout**). Each
promotion is scoped **sitewide**, to a **category** (code, e.g. `LAP`), to a
**brand** (name), or to one specific **product** (SKU id).

## Who can do this

Owner-only. Settings → Website Admin → Promotions tab.

## Steps

1. Open **Settings → Website Admin → Promotions**.
2. Fill in **Name** (internal label, e.g. "Festive Sale"), **Type**, and
   optionally a **Coupon Code** — leave it blank for a promotion that applies
   automatically to every matching order; set it to require the customer type
   that exact code (matched case-insensitively) at checkout.
3. Depending on Type: a **Discount %** (0–100) for `percent_off`, a
   **Discount ₹** for `flat_off`, or a **Free Gift SKU ID** (a `sku_master.id`)
   for `free_gift`.
4. Pick a **Scope** — Sitewide, Category (enter the category code), Brand
   (enter the brand name), or Specific Product (enter the SKU id).
5. Optionally set a **Min Order Value** — the promotion won't apply below
   this pre-discount cart total.
6. Set **Starts**/**Ends** (both required) — the promotion is enforced against
   this window server-side at checkout, independent of the Active toggle.
7. Check **Stackable** if this promotion should be allowed to combine with
   other promotions rather than compete with them (see below).
8. Save. A duplicate coupon code is rejected (409, "That coupon code is
   already in use"). Existing promotions can be toggled active/inactive
   without deleting them, or deleted outright.

## What happens at checkout

- `apps/web/lib/promotions.ts`'s `resolveApplicablePromotions()` runs
  server-side inside `POST /api/checkout/start` — it re-reads the live
  `promotions` table itself (active, within the `starts_at`/`ends_at` window)
  rather than trusting anything from the client beyond which coupon code the
  customer typed.
- A promotion with a `code` only becomes a candidate if the customer typed
  that exact code; a promotion with `code = null` is automatic.
- Each candidate's **scope** is matched against the cart's lines (by SKU id,
  brand, or category) and its **min order value** against the pre-discount
  cart total; a promotion matching zero lines, or below its minimum, is
  dropped.
- **Combinability**: among the remaining candidates, any number of
  **stackable** promotions all apply together; among **non-stackable**
  promotions, only the single best-discount one applies (the rest are
  dropped). So the maximum applied set is "all stackable promos + at most one
  non-stackable one."
- The resulting discount is **baked directly into each order line's
  `unit_price`** (distributed proportionally by each line's share of the
  pre-discount total), never left sitting only in `orders.discount_amount`
  metadata — this is deliberate, because `order-to-sale.ts`'s GST math reads
  only `unit_price × quantity`, so anything not baked in there would
  under-report revenue.
- A **free gift** is handled separately from the discount math: it adds a
  real `order_items` row for the gift SKU at `unit_price = 0`, flagged
  `is_promotional_gift`, which flows through the exact same inventory
  reservation and stock-decrement path as any paid line — never a
  side-channel that leaves stock uncounted. If the gift SKU has sold out by
  the time reservation actually runs, that one line is silently dropped
  rather than failing the whole order (a real paid item selling out at that
  point still fails the checkout with a 409, same as always).
- Every promotion actually applied (including a free-gift promo) is recorded
  in `promotion_redemptions` against the order and customer.

## Common mix-ups

- **"I set up a coupon-code promotion but customers can't seem to use it."**
  As of this writing, the website's checkout form (`CheckoutForm.tsx`) has no
  field for a customer to type a coupon code at all — `POST
  /api/checkout/start` already accepts and validates a `couponCode`, but
  nothing in the current UI sends one. A `code`-bearing promotion is
  effectively unreachable by a real customer until that input is added to
  checkout.
- **"Why doesn't the invoice show a separate discount line?"** — because the
  discount is baked directly into `unit_price`, not tracked as a distinct
  line item; the sale/invoice simply shows the already-discounted price.
- **"I turned the promotion off but it's still in the dropdown/list."**
  Toggling Active only stops it from applying at checkout — it's not deleted
  and stays visible (dimmed) in the admin list until you explicitly delete it.
- **"The promotion isn't applying even though it's active."** Check the
  Starts/Ends window — it's enforced server-side regardless of the Active
  toggle, so an active promotion outside its date window still won't apply.
