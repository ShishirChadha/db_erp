---
slug: qc-a-unit
title: QC'ing a unit
kind: process
audience: [owner, manager, employee]
module: live-stock-qc
routes: ['/dashboard/stock/[id]']
keywords: [qc, quality check, grading, grade, testing, checklist, battery health, condition grade]
sources:
  - apps/erp/app/api/asset-ledger/[id]/qc/route.ts
  - apps/erp/app/dashboard/stock/[id]/page.tsx
updated: 2026-11-24
---

## What this is

Running the QC checklist on a serialized unit after intake, before it's ready
to sell.

## Steps

1. Open the unit's detail page from **Live Stock** or **Stock**
   (`/dashboard/stock/[id]`).
2. Work through the checklist. It comes from the category's QC list in
   Settings → SKU Categories (`DEFAULT_CHECK_ITEMS` only when a category has
   none). Since 2026-11-24 laptops (40 points) and desktops (27) use the
   **Auto Check list** itself, so a hand QC and an Auto Check ask the same
   questions. Each item is free text, so checks can be added without a migration.
3. Enter condition sub-grades (screen/keyboard/body — `custom_options`-backed
   dropdowns) and, for laptops, battery health % and estimated backup hours.
4. Assign an overall grade: `A` / `B` / `C` / `D` / `Scrap`.
5. Submit. This writes rows to `asset_qc_checks` and updates `asset_ledger`'s
   QC/condition columns — `qc_status` moves from `pending`/`in_progress` to
   `passed` or `failed`.

## Faster, stricter: Auto Check (2026-11-23)

For a laptop or desktop running Windows, **Auto Check** fills this checklist
from the machine itself. A script reads the hardware and runs RAM, heat and disk
tests, and a guided test page on the laptop covers the screen, keys, ports and
so on. Its results are saved through this same QC route, so the unit page shows
them like a manual QC. Nothing in that flow starts as "pass". See **auto-check**.

**Re-testing a unit already in stock:** open it → **QC & Spec → Auto Test**.
Anyone with Live Stock or Stock access can, for any unit that is with us
(received, QC pending/passed, ready for sale, faulty, back from RMA — not on
rent, reserved, sold or scrapped). The new report **replaces** the old one
(the QC route always deletes the previous rows). A ready-for-sale unit that
passes stays on sale; any failed check takes it off sale as faulty. The QC
summary on the unit page lists every recorded check with its result and note.

## A failed check needs a part replaced (e.g. dead RAM, broken keyboard)

There's no direct link from a failed checklist item to a part — that's still
a manual step. Open a **Repair Job** on this same unit (Live Stock has a
one-click "Repair" button per row), tick "This is our own stock," pick the
unit, and add the accessory part consumed. Since the unit hasn't sold yet,
**no customer is required** for this job — see **open-a-repair-job**'s
"Repairing our own not-yet-sold stock" section. Marking that repair job Done
automatically sends the unit back here (`qc_pending`) for re-inspection —
you don't need to manually flip its status.

## Where this data goes next

If the SKU is later published to the website, `asset_qc_checks` is the
**source of truth for the public Test Report** — a new checklist item is a
client-side array edit here, never a new table, and this data is never
duplicated for the website.

## Units back from a trade-in (2026-11-23)

A laptop a customer gave us in part-payment arrives here as **QC pending**,
like any customer return, marked "Trade-in" on the Stock list. On its unit
page the owner sees its cost as the trade-in value with "Customer trade-in"
as the source. A unit we sold, took back and sold again has two live sales;
the unit page shows the newest. See **take-a-trade-in**.

## Related

**live-stock-qc**, **receive-stock**, **auto-check**, **website**.
