---
slug: inventory-sku
title: Inventory & SKU Master
kind: module
audience: [owner, manager, employee]
routes: [/dashboard/sku-master, /dashboard/stock]
keywords: [sku, inventory, catalog, stock, item master, category template, quantity, asset ledger, product]
sources:
  - apps/erp/app/api/sku-master/**
  - apps/erp/app/api/stock/**
  - apps/erp/lib/sku-categories.ts
updated: 2026-10-16
---

## What this covers

`sku_master` is the **single universal catalog** for every sellable physical
item — laptops, desktops, monitors, tablets, and every accessory (RAM, SSD,
CPU, GPU, keyboard, mouse, everything else via the generic `ACC` category).
There is no separate catalog/quantity table for any category.

## The serialized vs. fungible split — the most important thing to understand here

- **Serialized categories** (laptop/desktop/monitor/tablet) need **per-unit**
  tracking — serial number, QC result, warranty, individual sale — so each
  physical unit gets its own row in `asset_ledger`.
- **Fungible categories** (most accessories) are tracked by quantity alone.
  `stock_movements` (trigger-synced into `sku_master.quantity_in_stock`) is the
  universal ledger for **both** — a fungible item just never gets an
  `asset_ledger` row on top of it.

Check `sku-categories.ts`'s `NON_SERIALIZED_CATEGORIES` (also referenced on the
website side) before assuming a new category needs `asset_ledger` — most don't.

## `sku_category_templates` defines the spec schema per category

Adding a new *kind* of item (a new accessory type, say) means adding a category
row here — never a new table. `field_schema` (jsonb) drives what fields the SKU
form shows; see `generated/categories.md` for the live schema of every category
today.

## Stock vs. Live Stock — same table, deliberately non-overlapping views

The owner's `/dashboard/stock` (historical reconciliation, all sources) and the
employee-facing `/dashboard/live-stock` both read `asset_ledger`, filtered by
`source` (`employee_intake` vs. everything else). Never query across both
without a reason — they're kept apart on purpose while the owner works through
a backlog of legacy data. See **live-stock-qc**.

`GET /api/stock`'s search caches the category spec field names (used to build
the `specifications->>field ILIKE` clauses) for 60s rather than re-querying
`sku_category_templates` on every keystroke — a short-TTL in-memory cache,
same pattern as `lib/auth/redact.ts`'s redaction-rules cache. `StockView`'s
own search box debounces input by 300ms before it drives that fetch at all.

## Units out on rent

A unit on rent stays an ordinary `asset_ledger`/`sku_master` row with
`status = 'on_rent'` — there is no rental catalogue, no rental SKU category and no
second quantity mechanism. It leaves stock through the normal `stock_movements` ledger
(an `adjustment` of −1) and comes back the same way, so `quantity_in_stock` stays
honest throughout. See **rentals**.

## Website address (slug) changes

A SKU's `web_slug` is part of its public product URL. Editing it on a **published** SKU through
`PUT /api/sku-master/[id]` also writes a permanent redirect from the old address to the new one
(`seo_redirects`, see **website-seo**), so existing links and search listings keep working.

## One selling price per SKU

`web_price` and `selling_price_default` are always written together (SKU Master
edit, the Website dialog, the Price Cockpit and the Price Board all go through
`PUT /api/sku-master/[id]`'s validation). Repricing many SKUs is done on the
Price Board; see **use-the-price-board**.

## Related

**live-stock-qc**, **accessories**, **purchasing** (SKU resolution during PO
entry, via `lib/sku-resolver.ts`'s `resolveOrCreateSku`), **finance-gst-reports**
(inventory valuation).

## Why "newest on top" needs two date columns

`asset_ledger.sold_at` stores the sale DATE you picked, fixed at 12:00 UTC so a
timezone can never shift which day a sale displays as. That makes it unsuitable
for ordering within a day: two units sold on the same date have byte-identical
values.

`sold_recorded_at` (added 2026-10-01) holds the wall-clock moment the sale was
actually entered, and is what Sold Stock uses to break that tie. It is
maintained by a trigger, not by application code, because `status` becomes
`sold` in six separate places and any one of them forgetting to set it would
quietly bring the bug back.

The Sales Ledger has the same shape of problem and breaks its tie on
`sales.created_at`.
