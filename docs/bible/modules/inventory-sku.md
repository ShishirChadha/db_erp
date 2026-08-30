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
updated: 2026-08-30
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

## Related

**live-stock-qc**, **accessories**, **purchasing** (SKU resolution during PO
entry, via `lib/sku-resolver.ts`'s `resolveOrCreateSku`), **finance-gst-reports**
(inventory valuation).
