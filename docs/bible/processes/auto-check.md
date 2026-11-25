---
slug: auto-check
title: Auto Check (stock in + QC from the machine itself)
kind: process
audience: [owner, manager, employee]
module: live-stock-qc
routes: [/dashboard/entry/auto-check, '/qc-test/[code]', '/q/[code]', /q/go, /mac]
keywords: [auto check, mac, macbook, activation lock, find my, filevault, automatic qc, powershell, script, stock in, new entry, qc, quality check, battery report, dead pixel, keyboard test, bios password, computrace, company lock, naya maal]
sources:
  - apps/erp/app/dashboard/entry/auto-check/page.tsx
  - apps/erp/app/q/go/route.ts
  - apps/erp/app/mac/route.ts
  - apps/erp/app/qc-test/[code]/page.tsx
  - apps/erp/app/q/[code]/route.ts
  - apps/erp/app/api/qc-agent/**
  - apps/erp/lib/qc-agent/**
  - apps/erp/components/qc-agent/**
updated: 2026-11-25
---

## What this is

Stocking in a laptop or desktop and QC'ing it without typing the specs or
running PowerShell commands by hand. The physical check, cleaning, charger and
Windows install stay manual. After that:

1. On your **own** phone or PC: **New Entry → Auto Check** (or the **Auto Check**
   button on Live Stock / Stock). Leave "heat test" on unless you're in a hurry,
   and press **Start**. You get a 6-letter code and one line, e.g.
   `irm https://erp.digitalbluez.com/q/ABC123 | iex`.
2. On the laptop being checked: double-click **DB Auto Check** on the testing
   pen drive, click **Yes**, type the 6-letter code (a typo just asks again).
   No pen drive? **Win + X → Terminal (Admin)** and type the one line instead.
   No install, no ERP login on the laptop.
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

The review screen always shows the full configuration read from the machine
(Brand, Model, Processor, Generation, RAM, SSD, Screen size, Graphics and the
rest of the category's stock-entry fields, required ones starred) — editable
when a new SKU will be created, read-only when an existing SKU or unit is used.

**Resembling SKUs (2026-11-25).** Before making a new SKU the review screen
also looks for an existing one whose name only *resembles* Auto Check's (one
name contains the other, the same name without spaces, or the same Apple
A-number). CPU, RAM and SSD must be recorded on both and be equal, and no other
variant field may disagree. It then offers, as the default, **Use Auto Check's
name**: a new SKU with the fuller detail, with the old one merged into it.
Units, stock, website photos, listing and URL, price and history move, and the
old SKU is archived. The other choices are *Use the existing SKU as it is* and
*Not the same*. When the name already matches and the SKU only lacks detail
(resolution, webcam, …), the default fills those fields in place. See
**merge-duplicate-skus**.

A serial already in the ERP is recognised, and the save then **only replaces
that unit's QC report** — no second stock-in. This works for any unit that is
with us (received, in stock, QC pending/passed, ready for sale, faulty, back
from RMA). Sold, on rent, reserved for a web order or scrapped is refused. A
ready-for-sale unit that passes stays on sale; a failed check makes it faulty.

## Auto Test from a unit's page

**QC & Spec → Auto Test** on a laptop/desktop's detail page starts a run bound
to that unit (`qc_agent_sessions.options.asset_id`). It needs Live Stock or
Stock access (the QC route's grant), not New Entry. If the machine's serial is
not the unit's recorded serial — or belongs to another unit — the review
screen blocks the save as **wrong laptop**, and the run can't be closed
against a different unit.

## Several laptops at once

Start one check per laptop; each gets its own code and runs independently
(RAM, heat and disk tests run on each laptop by itself). While one is open,
**+ Check another laptop** opens a new tab for the next code. Every open run
is listed under **Unfinished checks** on the Auto Check start screen (yours;
managers and the owner see everyone's), so the engineer can hop between
laptops and save each when its tests finish. Codes last 2 hours.

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

## On a Mac (MacBook, iMac, Mac mini)

Same flow, same code, same review and save. On the Mac: **Command + Space →
Terminal**, type `curl -L erp.digitalbluez.com/mac | bash` (the same line for
every Mac), then the 6-letter code, then the Mac's login password. The password
is used on the Mac only (sudo) and is never sent; pressing Enter skips it, and
the checks that need it show "Couldn't check".

- **Mac locks:** Activation Lock / Find My (the lock that makes a used Mac
  unsellable — hard fail), company DEP/MDM enrollment and a Remote Management
  setup waiting for the Mac (password), firmware password (Intel, password; N/A
  on Apple Silicon), FileVault.
- **Shared tests, Mac sources:** S.M.A.R.T. status (Verified/Failing — a Mac
  can't report SSD wear %, so SSD health % stays blank), a 2 GB write/verify
  (the cache is flushed only with the password, otherwise it warns), a Perl RAM
  pattern test, heat (Intel: macOS's CPU speed limit; Apple Silicon: thermal
  pressure, password), kernel panics in 90 days, battery = Apple's own maximum
  capacity % + condition ("Service Recommended" fails), Wi-Fi, Bluetooth, USB
  ports by location, external display.
- **Mac guided steps:** a Mac keyboard layout (fn can't be seen by a browser,
  so it's the Fn-keys question), Touch Bar and Touch ID (skipped on models
  without them), the screen-coating ("staingate") check, force click.
- **Model:** macOS reports `MacBookAir10,1`, not the A-number. A table
  (`lib/qc-agent/mac-models.ts`) turns it into **MacBook Air A2337** + model
  year + screen size + Touch ID/Touch Bar. A Mac missing from the table shows
  the family name: type the A-number once (and add the row). Apple SKUs match
  **by A-number**, so "Macbook A2337" and "MacBook Air A2337" are the same.
  Apple SSD sizes round to 128/256/512 GB, 1/2 TB.
- Windows-only checks (BIOS password, Computrace, BitLocker, activation,
  disk-error log, Device Manager, original-parts scan) don't exist on a Mac; on
  the unit's manual QC form an Apple unit only sees the Mac items and vice versa.

## The pen drive launcher

`DB Auto Check.cmd` is downloaded once from the Auto Check start screen and
copied to the testing pen drive. It asks Windows for admin, then runs `/q/go`,
the same small script for every laptop. That script asks for the code,
checks it with `/q/<code>?check=1` (re-asking on a typo, expired code or no
internet) and runs that code's normal script. All logic is served fresh, so
the file on the pen drive never needs replacing. A file downloaded straight
onto a laptop may show a Windows "unknown publisher" warning; from a pen drive
it normally doesn't.

## RAM, SSD and graphics

- **SSD health %** = 100 − the drive's own "life used" counter (worst internal
  drive). Pre-filled on the review screen, editable, stored on the unit as
  `asset_ledger.storage_health_percent` and shown in its QC summary next to
  battery health; also typeable on the manual QC form. Needs Admin PowerShell.
- **RAM health** is the RAM test's result (errors, GB tested, passes), shown
  on the review screen and in the unit's QC summary and notes.
- **Graphics memory** comes from the display driver's registry
  (`HardwareInformation.qwMemorySize`); Windows' usual `AdapterRAM` is 32-bit
  and wrong from 4 GB up. The GPU is saved the way the dropdown spells it,
  e.g. `4GB NVIDIA T500`. SKU matching treats `NVIDIA T500` and `4GB NVIDIA
  T500` as the same card, and only compares memory when both state it.

## The code is the only credential on the laptop

The laptop never signs in. `/q/go` (no secrets, useless without a code),
`/q/[code]`, `/qc-test/[code]` and `/api/qc-agent/[code]/*` accept the 6-letter code (32^6 combinations, expires
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
- Mac: tested end to end on an Apple Silicon MacBook Pro; an Intel Mac run is
  still to be done at the shop.
- Desktops have no Generation field in their SKU template, so a desktop's CPU
  generation is detected but not saved. Add the field in Settings → SKU
  Categories and Auto Check fills it automatically.

## Related

**qc-a-unit**, **receive-stock**, **live-stock-qc**, **create-and-edit-a-sku**.
