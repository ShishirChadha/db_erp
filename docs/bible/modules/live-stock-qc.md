---
slug: live-stock-qc
title: Live Stock & QC
kind: module
audience: [owner, manager, employee]
routes: [/dashboard/live-stock, /dashboard/entry/intake]
keywords: [live stock, qc, quality check, intake, stock in, naya maal, grading, serial number, battery health, condition]
sources:
  - apps/erp/app/api/asset-ledger/**
  - apps/erp/app/dashboard/live-stock/page.tsx
  - apps/erp/app/dashboard/stock/[id]/page.tsx
updated: 2026-08-29
---

## What this covers

The employee-facing, day-to-day operational side of serialized inventory —
receiving a unit, QC'ing it, and everything that happens to it before it's
sold — all keyed by `serial_number`, not by a PO/asset number (see
**business-rules**: asset numbers are only ever a PO artifact).

## The lifecycle of a serialized unit

1. **Intake** (`source = 'employee_intake'`) — an employee records a new unit
   arriving, with a serial number, immediately real (see **receive-stock**).
2. **QC** (`asset_qc_checks`) — a checklist pass + grade (`A`/`B`/`C`/`D`/`Scrap`)
   + condition sub-grades (screen/keyboard/body) + battery health/backup
   estimate for laptops. See **qc-a-unit**.
3. **Ready to sell / sold / returned** — see **sales-invoicing** and
   **repairs-replacements-rma**.

A unit can move through all of this without ever having a PO or asset number —
that paperwork is attached later, independently, via **attach-units-to-po**.

## Live Stock vs. main ERP Stock

Both pages read `asset_ledger`; Live Stock filters `source = 'employee_intake'`,
main ERP Stock filters the opposite. Same underlying component
(`components/StockView.tsx`), parameterized, mounted at two routes — not two
copies. See **inventory-sku** for why they're kept apart.

## Related

**inventory-sku**, **qc-a-unit**, **receive-stock**, **attach-units-to-po**,
**sales-invoicing**.
