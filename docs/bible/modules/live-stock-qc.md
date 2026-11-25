---
slug: live-stock-qc
title: Live Stock & QC
kind: module
audience: [owner, manager, employee]
routes: [/dashboard/live-stock, /dashboard/entry/intake, /dashboard/entry/auto-check]
keywords: [live stock, qc, quality check, intake, stock in, naya maal, grading, serial number, battery health, condition]
sources:
  - apps/erp/app/api/asset-ledger/**
  - apps/erp/app/dashboard/live-stock/page.tsx
  - apps/erp/app/dashboard/stock/[id]/page.tsx
updated: 2026-11-25
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

The lifecycle isn't strictly one-way: a unit in `ready_for_sale` can be sent
back to `qc_pending` (`POST /api/asset-ledger/[id]/send-back-to-qc`) if a
defect is noticed after it was marked ready. Open to both owner and employees,
same as intake/QC itself. This resets `qc_status` to `pending` alongside
`status` so the two never disagree, but leaves the prior QC checklist/grade in
place as history rather than clearing it — a fresh QC pass overwrites them the
normal way (see **qc-a-unit**).

## Live Stock vs. main ERP Stock

Both pages read `asset_ledger`; Live Stock filters `source = 'employee_intake'`,
main ERP Stock filters the opposite. Same underlying component
(`components/StockView.tsx`), parameterized, mounted at two routes — not two
copies. See **inventory-sku** for why they're kept apart.

## On rent — a unit that is out but not gone

`asset_ledger.status` has a seventeenth value, `on_rent`, for a unit currently out with
a rental customer. It is not in `SELLABLE_STATUSES`, so it drops out of the Sell
picker and the website automatically, but it still shows on Stock / Live Stock under
the **On Rent** filter — out of the sellable pool, never invisible.

When the unit comes back it re-enters this module at `qc_pending` with
`qc_status = 'pending'`, exactly like a customer return, so it is re-checked before it
can be sold or rented again. See **rentals**.

## Back from a trade-in (2026-11-23)

A laptop a customer gives us in part-payment on an upgrade re-enters the
lifecycle at **QC pending**: a unit we sold before moves back from `sold` on
its existing row; one new to us gets a new `employee_intake` row with
`from_trade_in`. The Stock list marks it "Trade-in". Because such a unit can be
sold twice, it can have two live sales; every "this unit's sale" lookup (unit
page, force-delete, SKU reassignment, the Stock Sold tab) takes the newest.
Force-delete still refuses a unit with a live sale, and a trade-in's record
keeps a traded-in unit from being hard-deleted. See **take-a-trade-in**.

## Auto Check (2026-11-23)

Laptops and desktops can be stocked in and QC'd by **Auto Check**: a PowerShell
line typed on the machine, a no-login test page there, and a review screen on the
engineer's own device. Its runs live in `qc_agent_sessions` (service-role only,
kept per unit as the "hardware as received" record). It writes stock and QC only
through the normal intake and QC routes. See **auto-check**.

**Re-testing a unit already with us (2026-11-24).** Any unit physically with us
can be QC'd again (`RE_QC_STATUSES` in `lib/qc-agent/checklist.ts`, enforced by
`PUT /api/asset-ledger/[id]/qc` too) — by hand, or with **QC & Spec → Auto Test**
on the unit's page, which binds the run to that unit and blocks a different
machine as "wrong laptop". A known serial only replaces that unit's QC report;
it is never stocked in a second time. A passing re-QC keeps a unit that is on
sale `ready_for_sale`; a fail makes it `faulty`. Out on rent, reserved, sold or
scrapped units can't be re-QC'd.

**One QC list (2026-11-24).** The Laptop and Desktop checklists below were
replaced by the Auto Check points (40 for laptops, 27 for desktops, migration
`20261124c`), so a unit checked by hand and one checked by Auto Check answer the
same questions. The labels must stay identical to Auto Check's `CHECKS`, or Auto
Check adds them again as "extra checks". Checks already recorded on units are
unchanged.

**Macs and SSD health (2026-11-25).** The lists also carry six Mac items
(Activation Lock, firmware password, FileVault, screen coating, Touch Bar,
Touch ID; migration `20261125b`). The unit page's manual QC form shows an Apple
unit only the Mac items and every other unit only the Windows items
(`otherPlatformLabels()`). `asset_ledger.storage_health_percent` (SSD health %,
100 − drive wear) is set through the same QC route, typeable on the manual form
and shown in the QC summary next to battery health; the route leaves it alone
when a caller doesn't send it. Macs can't report wear, so it stays blank there.

## Related

**inventory-sku**, **qc-a-unit**, **receive-stock**, **auto-check**, **attach-units-to-po**,
**sales-invoicing**.

## QC checklists are per category

Until 2026-10-01 every serialized unit was checked against one hardcoded list of
12 items, written for laptops. A Monitor was therefore asked about "Keyboard",
"Trackpad", "Battery Health" and "Boot / OS" -- 11 monitors and 14 desktops had
already been QC'd that way.

The checklist now lives on `sku_category_templates.qc_checklist`, beside the
spec `field_schema` that was already per-category, so both are owner-editable in
one place and no new table was needed. Seeded lists:

- **Laptop** - 12 items, unchanged from the old default
- **Desktop** - PSU, fans/cooling, storage health, RAM, network; no battery, no trackpad
- **Monitor** - panel/dead pixels, backlight uniformity, colour, inputs, OSD, stand/VESA
- **Tablet** - touch response, battery, charging, camera, buttons
- **Other / Camera** - a short generic list

A category with no checklist configured falls back to the laptop list, so QC
never silently loses its questions.

The structured fields are gated the same way: Battery Health and Estimated
Backup appear only for Laptop and Tablet, Keyboard Condition only for Laptop,
Screen Condition for Laptop, Tablet and Monitor. Body Condition and the grade
apply to everything.

Existing QC records are untouched -- `asset_qc_checks.check_item` is free text,
so historical rows keep whatever was asked at the time.
