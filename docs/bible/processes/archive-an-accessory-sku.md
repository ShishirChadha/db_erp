---
slug: archive-an-accessory-sku
title: Archiving an accessory SKU
kind: process
audience: [owner]
module: accessories
routes: [/dashboard/accessories]
keywords: [archive accessory, purana sku, discontinue accessory, hide sku, remove accessory, reactivate sku, sku hataana, deactivate accessory]
sources:
  - apps/erp/app/dashboard/accessories/page.tsx
  - apps/erp/app/api/sku-master/[id]/route.ts
updated: 2026-09-16
---

## What this is

Marking an accessory SKU (`ArchiveControl`, on the Accessories list page) as
no longer active, via `sku_master.status`. This is the soft-delete
equivalent for `sku_master` rows — the alternative to a hard `DELETE`, which
fails outright once a SKU has any real purchase/sale history attached (a
foreign-key `RESTRICT`). Archiving exists specifically for exactly that
situation: an item you want gone from day-to-day view but whose history you
can't and shouldn't erase.

## Who can do this

Owner only, both in the UI and enforced server-side. The **Archive** button
on the Accessories page only renders when `isOwner` is true, and it calls
`PUT /api/sku-master/[id]` with `{ status: 'archived' }` — that route
requires `isOwner()` for the `status` field (it's not one of the
website-only fields a non-owner can touch via the `website` page grant).

## Steps

1. On the **Accessories** page, find the SKU and click **Archive**.
2. No confirmation dialog — it applies immediately (`toggle()` fires
   straight from the click).
3. The row now shows dimmed (`opacity-50`) with an `(archived)` label next
   to its name, and the action button now reads **Reactivate**.
4. Click **Reactivate** at any time to set `status` back to `active` — this
   is treated as an ordinary update, not a "restore" (the Audit Log's
   restore mechanism is reserved for the initial `active → archived`
   transition, which is logged as a `soft_delete` with
   `restoreStatus: 'restorable'`).

## What archiving does and doesn't affect

- **Reversible** — see Reactivate above. Nothing about the row itself is
  destroyed; only `status` (and `is_published`/`published_at`, if it was
  published on the website, are not automatically touched by this action
  specifically — archiving and unpublishing are separate concerns).
- **Existing stock and history stay completely intact.** `quantity_in_stock`
  is untouched, every `stock_movements` row remains, every `asset_ledger`/
  `purchase_order_items`/`sales`/invoice reference to this SKU stays valid.
  Archiving is purely a visibility flag, not a data operation.
- **Hidden from search and dropdowns by default, everywhere.** `GET
  /api/sku-master` defaults to `status = 'active'` whenever no explicit
  `status` param is passed — which is what every picker/search (PO wizard's
  SKU search, Sell's accessory picker, Stock Intake's spec-prefill lookup,
  etc.) calls with. An archived SKU simply stops turning up anywhere new
  stock or sales would reference it. It still appears on the SKU Master and
  Accessories list pages themselves under their own "Archived" filter tab
  (`status=archived` / `status=all`), and any existing sale/invoice/PO that
  already referenced it before archiving displays it exactly as before —
  archiving doesn't retroactively hide history that already points to it.
- **Doesn't prevent further stock movements at the API level.** The
  Accessories page only shows Receive Stock/Sell/Correct Quantity buttons
  when `status === 'active'`, but that's a UI convenience, not a check
  enforced in `POST /api/sku-master/[id]/stock-movement` itself — an
  archived SKU's id could still technically accept a movement if called
  directly.

## Common mix-ups

- **"I archived the wrong SKU."** — just click Reactivate; nothing was lost.
- **"I can't delete this SKU at all."** — that's expected once it has sold
  units or purchase history (`23503` foreign-key error from a hard
  `DELETE`); Archive is the intended path for that case. If it's actually a
  duplicate of another SKU rather than something you want to retire, use
  **merge-duplicate-skus** instead — merging both archives the source *and*
  moves its history onto the kept SKU, which plain Archive doesn't do.
- **"The archived SKU still shows on a past invoice."** — correct and
  intentional; archiving only affects forward-looking search/pickers, not
  already-recorded documents.
