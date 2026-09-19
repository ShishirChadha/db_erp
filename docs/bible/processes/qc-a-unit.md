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
updated: 2026-09-15
---

## What this is

Running the QC checklist on a serialized unit after intake, before it's ready
to sell.

## Steps

1. Open the unit's detail page from **Live Stock** or **Stock**
   (`/dashboard/stock/[id]`).
2. Work through the checklist (`DEFAULT_CHECK_ITEMS` — includes Camera, Audio,
   WiFi, Charging, Stress Test among others; each item is free text, so new
   checks can be added without a migration).
3. Enter condition sub-grades (screen/keyboard/body — `custom_options`-backed
   dropdowns) and, for laptops, battery health % and estimated backup hours.
4. Assign an overall grade: `A` / `B` / `C` / `D` / `Scrap`.
5. Submit. This writes rows to `asset_qc_checks` and updates `asset_ledger`'s
   QC/condition columns — `qc_status` moves from `pending`/`in_progress` to
   `passed` or `failed`.

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

## Related

**live-stock-qc**, **receive-stock**, **website**.
