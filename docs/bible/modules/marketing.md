---
slug: marketing
title: Marketing Content Studio
kind: module
audience: [owner, manager, employee]
routes: [/dashboard/marketing]
keywords: [marketing, whatsapp, whatsapp broadcast, social media, instagram, facebook, google business profile, ai content, collage, product card, today's picks, single product, blog draft, prachar, vigyapan, whatsapp bhejna, content studio]
sources:
  - apps/erp/app/dashboard/marketing/page.tsx
  - apps/erp/app/api/marketing/generate/route.ts
  - apps/erp/app/api/marketing/products/route.tsx
  - apps/erp/app/api/marketing/collage/route.tsx
  - apps/erp/app/api/marketing/card/route.tsx
updated: 2026-09-16
---

## What this is

An AI-assisted content generator for promoting real current stock on
WhatsApp, Instagram, Facebook, and Google Business Profile — its own
top-level sidebar item (`Marketing`, `/dashboard/marketing`), distinct from
the 14 other modules because it doesn't fit any of them: it isn't inventory,
sales, or website configuration, it's outbound content creation grounded in
live data from those systems.

Everything it generates is grounded in **real current stock**
(`findInStockProducts` / `getInStockProductById`, reading `source =
'employee_intake'` live inventory), independent of whether a SKU is published
to the website (`sku_master.is_published`). This is a deliberate split:
WhatsApp content carries no product link, so it can promote anything
currently in stock; Instagram/Facebook/Google Business Profile content always
ends with a real deep link to the product page, so those three platforms
*do* require the SKU to be published first (`getPublishedProductById`
returns nothing otherwise, and generation fails with a clear message
pointing to SKU Master → Website).

## Access is a gated page, not role-based by default

Like other per-page-gated screens, `hasPageAccess(sessionUser, 'marketing')`
governs who can open `/dashboard/marketing` and call any `/api/marketing/**`
route — the owner always has access; a manager or employee needs an explicit
grant. A separate `canEditPage('marketing')` check gates the mutating actions
on the **Drafts** tab (approve / mark published / delete) — viewing and
generating content is not automatically the same permission as managing the
draft pipeline.

## Four tabs, one draft pipeline

- **Today's Picks** — browse/filter live stock by category, brand, and CPU;
  multi-select specific items or generate for everything the filters match;
  download a multi-item photo collage when 2+ items are selected. This tab
  absorbed the old **Product List** tab entirely (see
  **generate-marketing-assets** and `docs/decisions.md`, 2026-09-11, for the
  history) — there is no separate Product List screen anymore.
- **Single Product** — search current stock by brand/model/SKU code and
  generate content for one item on a chosen platform.
- **Blog Draft** — generates a long-form blog draft (title + Markdown body +
  tags) grounded in published products matching a category, via AI. Saved as
  a draft only — "Publishing a blog post live is a Phase 2 feature," per the
  UI's own copy; there is no publish action for blog content today.
- **Drafts** — lists every `marketing_assets` row generated across all tabs,
  with status (`draft` → `approved` → `published`) and delete, gated by
  `canEditPage('marketing')`.

## WhatsApp is a fixed template, not AI — everything else is AI-authored

WhatsApp content (single-item or multi-item) is built from a fixed,
terse, emoji-bulleted template (`buildSingleProductWhatsAppMessage` /
`buildProductListWhatsAppMessage`) — deliberately **not** AI-generated,
since it's the owner's real, highest-frequency channel (sent daily) and its
style is fixed, not narrative prose. Instagram, Facebook, Google Business
Profile captions, and blog drafts go through an AI generation path instead
(`generateSingleProductPost` / `generateBlogDraft`, model `claude-sonnet-5`),
which is metered by a **daily AI-generation cap** (`marketing_settings.
daily_generation_cap`, default 50, adjustable in Settings → Marketing) —
WhatsApp generation costs zero AI tokens and is never counted against it.

## Related

**website** (publish status gates Instagram/Facebook/Google Business Profile
and cross-sell/product-link content, but not WhatsApp or product cards),
**inventory-sku** (the live-stock data everything here reads from),
**settings-admin** (Settings → Marketing configures brand voice, default CTA,
contact block, disclaimer, WhatsApp flavor lines, and the daily AI cap).
