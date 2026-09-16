---
slug: generate-marketing-assets
title: Generating marketing content (WhatsApp, cards, collages, social posts)
kind: process
module: marketing
audience: [owner, manager, employee]
routes: [/dashboard/marketing]
keywords: [whatsapp broadcast, generate marketing, product card, collage, download card, today's picks, single product, instagram post, facebook post, google business profile, whatsapp message, prachar banana, vigyapan banana, photo collage]
sources:
  - apps/erp/app/dashboard/marketing/page.tsx
  - apps/erp/app/api/marketing/generate/route.ts
  - apps/erp/app/api/marketing/collage/route.tsx
  - apps/erp/app/api/marketing/card/route.tsx
  - apps/erp/app/api/marketing/products/route.tsx
updated: 2026-09-16
---

## What this is

The click-by-click flow for turning real current stock into WhatsApp
messages, downloadable product cards, multi-item photo collages, or
AI-authored Instagram/Facebook/Google Business Profile posts, from the
Marketing Content Studio (`/dashboard/marketing`). See **marketing** for the
module-level picture (access gating, the AI daily cap, WhatsApp's
fixed-template vs. AI-authored split).

## Who can do this

Any signed-in staff member with access to the **Marketing** page
(`marketing` page key) can browse and generate. Approving/publishing/deleting
a draft on the Drafts tab additionally needs the `marketing` **edit** grant
(`canEditPage`) — the owner always has both.

## Steps — Today's Picks (browse, multi-select, bulk WhatsApp, collage)

1. Open **Marketing → Today's Picks** (the default tab).
2. Filter the grid by **Category code** (e.g. `LAP`), **Brand**, and/or
   **CPU** — it only shows items currently in stock (`in_stock=true` by
   default), grouped and sorted by brand, then by CPU tier/generation within
   each brand (i3 → i5 → i7 ascending), matching the order the generated
   WhatsApp message itself uses.
3. Optionally type a custom **Broadcast theme** (e.g. "All Dell i5 laptops in
   stock") — overrides the auto-generated theme text.
4. Either:
   - Leave nothing ticked and click **Generate WhatsApp (all filtered)** —
     covers every item currently matching the filters (capped at 60 items per
     message so an unfiltered request can't dump the entire catalogue into
     one broadcast); or
   - Tick specific items (checkbox per card) and click **Generate WhatsApp
     (N selected)** — scopes the message to exactly those items.
5. With 2 or more items ticked, a **Download collage (N photos)** button
   appears — renders one branded PNG with one photo per selected item (up to
   9; a `sku_ids` list past 9 is silently truncated). Items with no uploaded
   photo are skipped in the grid, not shown as a blank cell.
6. With exactly 1 item ticked, a **Download card** control appears instead
   (same per-item card as Single Product, below).
7. The generated WhatsApp text appears below with **Copy text**, **Open in
   WhatsApp** (a `wa.me` deep link), and — on browsers that support the file
   Web Share API (mostly mobile) — a **Share** button that hands the photo
   and text to the OS share sheet together in one action.

## Steps — Single Product (one item, any platform)

1. Open **Marketing → Single Product**.
2. Search by brand, model, or SKU code — the picker searches *current
   stock*, any publish status, not just SKU Master's published items.
3. Select a result, then pick a **Platform**: WhatsApp, Instagram, Facebook,
   or Google Business Profile.
   - **WhatsApp** works for any in-stock item regardless of website-publish
     status.
   - **Instagram / Facebook / Google Business Profile** require the item be
     published on the website first (they always end with a real product
     link) — attempting one on an unpublished SKU fails with a message
     pointing to SKU Master → Website.
4. Click **Generate**. WhatsApp uses the fixed template; the other three go
   through the AI path (subject to the daily generation cap) and produce a
   caption + hashtags + CTA + alt text, with the product URL and any
   configured contact block appended.
5. From the result: edit the body text inline and **Save edits**, **Copy
   text**, **Open in WhatsApp** (WhatsApp only), or **Download card** — a
   per-item branded PNG (using up to 4 of that item's uploaded photos) in one
   of four formats: WhatsApp Square (1080×1080), Instagram Portrait
   (1080×1350), Instagram Story (1080×1920), or Facebook Link (1200×630).
   The owner additionally sees **Save as flavor line** on a WhatsApp result —
   stores the edited line into `marketing_settings.whatsapp_flavor_lines` for
   future generations to draw from.

## Steps — Blog Draft

1. Open **Marketing → Blog Draft**.
2. Enter a **Topic** (e.g. "Best i5 laptops under ₹25,000") and optionally a
   **category** to ground it in (only published products in that category
   feed the draft, up to 8).
3. Click **Generate draft** — produces a title + Markdown body via AI (same
   daily cap as Instagram/Facebook/Google Business Profile). Edit inline and
   **Save edits**. There is no publish action here — it's saved as a draft
   only.

## Steps — Drafts (manage what's been generated)

1. Open **Marketing → Drafts** to see every generated asset across all tabs,
   with its platform, kind, and status.
2. With the `marketing` edit grant: move a `draft` to `approved`, an
   `approved` one to `published`, or delete any of them.

## Common mix-ups

- **"Why can't I generate an Instagram post for this laptop?"** — it isn't
  published on the website yet. Publish it via SKU Master → Website first
  (see **publish-a-sku-to-website**), or use WhatsApp instead, which has no
  publish requirement.
- **"Generate failed with a cap-reached error."** — only Instagram/Facebook/
  Google Business Profile/Blog generation counts against
  `marketing_settings.daily_generation_cap` (default 50/day); WhatsApp
  generation is free and uncounted, so switching platforms works around a
  cap that's been hit for the day.
- **"Collage vs. card — what's the difference?"** A **collage**
  (`/api/marketing/collage`) is one photo each from *several different*
  products (Today's Picks, 2+ items ticked). A **card**
  (`/api/marketing/card`) is up to 4 photos of *one* product (Single Product,
  or Today's Picks with exactly 1 item ticked).
- **"An item has no photo — what happens?"** A `NoPhotoWarning` shows before
  the download control, and the rendered card falls back to a plain color
  block rather than failing; for a collage, that item is simply omitted from
  the grid rather than shown as a blank tile.
- **"Where did the Product List tab go?"** It was retired on 2026-09-11 —
  Today's Picks absorbed its filtering, bulk generation, and custom
  broadcast-theme override, so there's no separate tab for it anymore (see
  `docs/decisions.md`).
