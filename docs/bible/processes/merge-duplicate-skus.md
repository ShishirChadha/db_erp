---
slug: merge-duplicate-skus
title: Merging duplicate SKUs
kind: process
audience: [owner]
module: inventory-sku
routes: [/dashboard/sku-master]
keywords: [merge sku, duplicate sku, sku jodna, do sku ek karna, combine sku, same sku twice, spelling variant, dedupe]
sources:
  - apps/erp/components/MergeSkuDialog.tsx
  - apps/erp/app/api/sku-master/merge/route.ts
  - apps/erp/app/api/sku-master/duplicate-candidates/route.ts
  - apps/erp/app/dashboard/sku-master/page.tsx
  - apps/erp/app/api/qc-agent/sessions/[id]/upgrade-sku/route.ts
updated: 2026-11-25
---

## What this is

Combining two or more `sku_master` rows that really represent the same
sellable item (typically created by spelling variants, or two people
creating the same SKU independently) into one canonical row. Every table
that references the source SKUs — `asset_ledger`, `purchase_order_items`,
`invoice_items`, `sales_document_items`, `sales`, `repair_job_parts`,
`reorder_rules` — gets repointed to the kept ("target") SKU, and the merged-
away rows are archived, not deleted.

This is deliberately separate from **change-a-units-sku**'s "Fix SKU"
dialog, which reassigns *one unit* (or one PO line item) at a time and has
no concept of archiving a whole `sku_master` row.

## Who can do this

Owner only. Unlike SKU Master's own `GET`/`POST` routes (which use a
page-access gate), `/api/sku-master/merge`'s `GET` (preview) and `POST`
(execute) both check `isOwner()` directly — a page-access grant to
`sku_master` does not imply merge rights, since this is data-integrity
surgery, not ordinary catalog editing.

## When to use this

The SKU Master page automatically surfaces possible duplicates (owner-only,
`GET /api/sku-master/duplicate-candidates`) as a dismissible warning banner
("N possible duplicate group(s) found") — this is currently the only
entry point into the merge dialog; there's no manual "pick any two SKUs and
merge them" picker outside of that detected cluster.

## Steps

1. On **SKU Master**, expand the duplicate-candidates banner and click
   **Merge...** on the cluster you want to resolve.
2. **Pick which SKU to keep** (the target) — a radio button per candidate,
   defaulting to whichever has the most stock.
3. For every other row in the cluster, review its config diff
   (`buildConfigDiff`) and **uncheck** any that are actually a genuinely
   different variant (e.g. different RAM/SSD) rather than a true duplicate —
   checked rows are what actually gets merged; unchecked ones stay
   untouched as their own SKU.
4. The dialog fetches a live preview per source SKU showing exactly what will
   move: quantity in stock, tracked asset count, how many of those assets are
   already on a finalized invoice, and any reorder rules — plus a
   `category_mismatch` flag if a source is a different category than the
   target (merge is blocked outright in that case, no override in the UI).
5. Optionally enter a reason (kept in the audit log).
6. Confirm — the confirmation dialog restates exactly how much stock/assets
   will move and how many source rows will be archived, and explicitly warns
   **"This cannot be undone from the UI."**
7. Submit calls the `merge_sku_master` RPC, which does the actual repointing
   and archiving in one transaction.

## What moves (2026-11-25)

Everything that points at a SKU moves to the target:
- **Units:** `sku_id`, plus `current_sku_id` for units reassigned with Change SKU.
- **Stock:** as one adjustment pair; history isn't rewritten.
- **Documents and jobs:** PO lines, invoice and quotation lines, accessory sales, repair, replacement and RMA parts.
- **Commerce:** rentals, online orders and reservations, carts and wishlists.
- **Pricing and marketing:** price history, market and competitor prices, free-gift promotions, marketing cards.
- **Website photos:** placed after the target's own, with one primary kept.

The target keeps whatever it already has. Where it has nothing, it takes these from the source:
- the website listing: published state, the **URL slug** (so customers' links keep working), title, description, highlights and grade;
- the single selling price (`web_price` and `selling_price_default` together) and the MRP;
- cost, HSN, warranty label, and any spec fields it lacks.

The archived source is unpublished. Before 2026-11-25 photos, listing, price,
rentals, online orders and `current_sku_id` were left behind on the archived
row, and the function was callable with the website's public key (revoked).

## From Auto Check

When Auto Check finds an existing SKU with the same machine and configuration
but a weaker name ("Macbook A2337" vs "MacBook Air A2337", "T14 Gen 2" vs
"ThinkPad T14 Gen 2"), the review screen offers to use Auto Check's name. That
creates the Auto Check-named SKU and merges the old one into it through this
same RPC, and switches the old model name off in the dropdown once no active
SKU uses it. By owner decision this works for **anyone running Auto Check**
(New Entry access): it is the one non-owner path to a merge. It can only
merge the SKU the run's own evaluation matched, and only when the variant
config still agrees. If the name is already the same and the SKU only lacks
detail, the missing spec fields are filled in place instead. See **auto-check**.

## Is it reversible?

Not from the UI. The RPC archives (not hard-deletes) each source SKU row —
so the row and its old `full_sku_code` still exist and could theoretically
be restored by hand — but there is no restore handler wired up for this
action in `lib/audit-log-restore.ts` (`restoreStatus: 'not_applicable'` on
the audit log entry, unlike an ordinary archive via **archive-an-accessory-
sku**, which *is* restorable). Treat a merge as one-way in practice.

## Common mix-ups

- **"I don't see a duplicate banner but I know two SKUs are the same."** —
  merge only works through a detected cluster today; if the automatic
  detector didn't flag the pair, there's currently no manual picker to merge
  them anyway.
- **"Merge button is disabled."** — check for a `category_mismatch` warning
  on any included source row; cross-category merges are blocked entirely,
  not just warned about.
- **"A unit on this SKU is already invoiced — can I still merge it?"** — yes,
  the preview shows an `invoiced_asset_count` as information, not a block;
  merging still repoints it, same as **change-a-units-sku**'s finalized-
  invoice warning does for a single-unit reassignment.
