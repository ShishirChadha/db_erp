---
slug: auto-check
title: Auto Check (stock in + QC from the machine itself)
kind: process
audience: [owner, manager, employee]
module: live-stock-qc
routes: [/dashboard/entry/auto-check, '/qc-test/[code]', '/q/[code]']
keywords: [auto check, automatic qc, powershell, script, stock in, new entry, qc, quality check, battery report, dead pixel, keyboard test, bios password, computrace, company lock, naya maal]
sources:
  - apps/erp/app/dashboard/entry/auto-check/page.tsx
  - apps/erp/app/qc-test/[code]/page.tsx
  - apps/erp/app/q/[code]/route.ts
  - apps/erp/app/api/qc-agent/**
  - apps/erp/lib/qc-agent/**
  - apps/erp/components/qc-agent/**
updated: 2026-11-23
---

## What this is

Stocking in a laptop or desktop and QC'ing it without typing the specs or
running PowerShell commands by hand. The physical check, cleaning, charger and
Windows install stay manual. After that:

1. On your **own** phone or PC: **New Entry → Auto Check** (or the **Auto Check**
   button on Live Stock / Stock). Leave "heat test" on unless you're in a hurry,
   and press **Start**. You get a 6-letter code and one line, e.g.
   `irm https://erp.digitalbluez.com/q/ABC123 | iex`.
2. On the laptop being checked: **Win + X → Terminal (Admin)**, type that line,
   press Enter. No install, no ERP login on the laptop.
3. The script reads the hardware (~40 s), uploads it, and opens a **test page**
   in the laptop's browser. It then runs the RAM test (4 min), the heat test
   (3 min) and the disk test (1–2 min) in the background.
4. Go through the test page while those run, one screen per area: locks, physical
   check, cosmetic grade, screen colours (tap any dot), light bleed, brightness,
   touch, keyboard (every key + stuck-key check), trackpad, speakers, microphone,
   camera, audio jack, USB ports, display output, LAN, charger, fan.
5. Back on your screen the stock-in form and QC list have filled themselves in.
   Type the last 6 characters of the **serial on the bottom sticker**, settle
   anything marked **Check this / Couldn't check / Not answered**, pick
   Purchased By, then **Stock in + Save QC**.

The whole run is roughly 10–12 minutes per laptop, mostly unattended.

## What is checked, and who decides

- **By the script:**
  - **Locks:** BIOS password (Lenovo/HP/newer Dell report it; other brands are asked by hand), company lock (Azure AD/domain/MDM/Autopilot), Computrace/Absolute, BitLocker, Windows activation.
  - **Disks:** health and wear, a 2 GB write-and-read-back test, disk errors in the system log.
  - **RAM:** a pattern test over about 70% of free memory.
  - **Heat:** whether the CPU holds its base speed after 3 minutes at full load.
  - **System:** crashes and WHEA hardware errors, devices without drivers, Wi-Fi and Bluetooth.
  - **Battery:** health (full-charge ÷ design capacity) and cycle count.
  - **Repair signs:** a "possible repair" scan covering a blank BIOS serial, a screen panel made years after the model, a generic battery maker, an unknown SSD brand, and mismatched RAM sticks.
- **By a person** (the test page, or the review screen): everything a script
  can't see, including screen dots and lines. The page shows full-screen colours
  and the engineer taps where any dot is. Also hinges, cracks, signs of the case
  being opened, liquid damage, and the cosmetic grade.
- **Nothing starts as pass.** A check that couldn't run, a warning, or an
  unanswered question blocks the save. A failed check marks the unit **faulty**
  (the existing QC rule). Turning a hard fail into a pass needs a written reason,
  which is saved in that item's note as `OVERRIDE by engineer: …`.
- Thresholds (battery 70/60 %, SSD wear 80 %, heat 90/75 % of base clock, …) live
  in one place: `THRESHOLDS` in `lib/qc-agent/rules.ts`.

## SKU: matched or created

The review screen looks for an existing SKU with the same brand + model and the
same price-relevant fields (CPU, generation, RAM, SSD, GPU, screen) and
pre-selects it. When there isn't one, a new SKU is created from the detected
specs through the normal `resolveOrCreateSku`. Matching is done this way, not
by sending the detected specs, because `resolveOrCreateSku` only reuses a SKU
when *every* spec is identical. Auto Check fills more fields (resolution,
webcam, OS) than most existing SKUs have, so every unit would otherwise mint a
duplicate SKU. Detected values that aren't in the dropdown lists yet (a new model
name, say) are added to them on save.

A serial already in the ERP is recognised. If that unit is QC pending, QC passed
or faulty, the save only records QC. Any other status (sold, on rent, …) is
refused.

## What gets saved where

- `POST /api/stock-intake`: the unit (`asset_ledger`, `source = employee_intake`,
  `qc_pending`), its `stock_movements` receipt, SKU match/create, audit entry.
  Unchanged route.
- `PUT /api/asset-ledger/[id]/qc`: one `asset_qc_checks` row per check (the
  labels are customer-readable because they feed the website Test Report; notes
  stay internal), grade, battery %, backup hours, conditions. Unchanged route.
- `qc_agent_sessions`: the raw hardware report, background results and test-page
  answers, kept after the save with `asset_id` set, as the unit's "hardware as
  received" record.

## The code is the only credential on the laptop

The laptop never signs in. `/q/[code]`, `/qc-test/[code]` and
`/api/qc-agent/[code]/*` accept the 6-letter code (32^6 combinations, expires
after 2 hours, dead the moment the run is saved). They can only write into
their own `qc_agent_sessions` row, never stock or QC. Everything real is written
by the engineer's own logged-in save. The table is service-role only (RLS on, no
policies, anon/authenticated revoked).

## Limits, plainly

- The in-Windows RAM test catches most bad RAM, but a boot-time MemTest86 run is
  deeper. Use it on units that fail or show crash history.
- Temperature in °C is only available on machines that report it, so the heat
  verdict is based on speed held, not °C.
- Without an Admin PowerShell, disk wear, BitLocker and TPM can't be read. Those
  checks show "Couldn't check" and must be decided by hand.
- The script expects English Windows for the Wi-Fi network count.
- Desktops have no Generation field in their SKU template, so a desktop's CPU
  generation is detected but not saved. Add the field in Settings → SKU
  Categories and Auto Check fills it automatically.

## Related

**qc-a-unit**, **receive-stock**, **live-stock-qc**, **create-and-edit-a-sku**.
