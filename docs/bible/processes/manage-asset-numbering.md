---
slug: manage-asset-numbering
title: Managing per-entity asset numbering counters
kind: process
module: settings-admin
audience: [owner]
routes: [/dashboard/settings]
keywords: [asset numbering, asset counter, asset number, DBAS, TTAS, CSAS, OTHR, year suffix, last used sequence, recalculate counters, refresh counters, prefix, asset number series, numbering migration]
sources:
  - apps/erp/app/dashboard/settings/page.tsx
  - apps/erp/app/api/settings/asset-counters/route.ts
updated: 2026-09-16
---

## What this is

Settings → Asset Numbering (`AssetNumberingSection`, defined inline in
`app/dashboard/settings/page.tsx`) configures the per-entity, per-year
counters behind asset-number generation (`DBAS26-701`-style numbers). There
are four fixed prefixes, one per buying/entity bucket: `DBAS` (Digitalbluez),
`TTAS` (Techtenth), `CSAS` (Cash), `OTHR` (Other). Real asset numbers are
still only ever minted through the atomic `reserve_assets()` RPC elsewhere
in the app (see `business-rules` / `po-corrections`) — this screen only
edits the *counter* each of those calls reads from, never assigns a number
to a unit itself.

## Who can do this

The Settings tab itself is owner-only (`asset_numbering`,
`ownerOnly: true` in the page's `CATEGORIES` list), so in normal use only
the owner ever sees this screen. **However**, unlike essentially every other
route in this module, the underlying API does **not** independently enforce
`isOwner()`:

- `GET /api/settings/asset-counters` requires no authentication at all.
- `PUT`/`POST /api/settings/asset-counters` call `getSessionUser(req)` but
  never check the resulting role — any signed-in user (including an
  `employee`) who called these endpoints directly could edit or recalculate
  the counters, even though the UI never exposes that ability to them.

This is worth knowing precisely because it's the odd one out: every sibling
owner-only screen in this module (Dropdown Options' edit/delete, Field
Redaction, Business Profiles, Users, Tags) enforces the restriction
server-side too. Asset Numbering currently relies on the Settings tab being
hidden from non-owners in the UI, not on the API itself.

## Steps — editing a counter

1. Open **Settings → Asset Numbering**. One row per entity (Digitalbluez /
   Techtenth / Cash / Other), each showing its prefix, an editable **Year
   Suffix** (2 digits, e.g. `26`), an editable **Last Used Seq**, and a live
   **Preview** of what the next asset number would look like
   (`{prefix}{suffix}-{last+1}`).
2. Edit **Year Suffix** and/or **Last Used Seq** for a row.
3. Click **Save** on that row. This calls `PUT /api/settings/asset-counters`
   for that one prefix.
4. **The counter can't be set below the true existing maximum.** The server
   re-scans up to 5000 `asset_ledger` rows matching that prefix, restricted
   to the exact `{prefix}{yearSuffix}` new-format pattern (`^PREFIX\d{2}-\d+$`),
   to find the real highest sequence number already in use for that
   prefix+year — and refuses the save with a 400 if your new `last_number`
   is lower than that. This is the same anti-collision protection the
   invoice-counter cutover has, applied to asset numbers.
5. After a successful save, the screen automatically refetches all counters.

## Steps — recalculating from actual data

Click **Refresh Counters from Database** at the bottom. This calls
`POST /api/settings/asset-counters`, which re-derives every prefix's true
maximum sequence number directly from `asset_ledger` (same new-format-only
scan logic as above) and overwrites all four counters to match — useful
after a bulk import, a manual DB fix, or any situation where the stored
counter might have drifted from what's actually been assigned.

## Why old-format numbers are ignored

Some historical asset numbers were issued without a year segment (e.g.
`DBAS682`, no `26-` in the middle). Both the save-validation scan and the
recalculate action deliberately **exclude** these old-format numbers from
the "current max" calculation — a naive string comparison would otherwise
rank `"DBAS682"` above a higher genuine new-format number like `"DBAS26-699"`
purely because `'6' > '2'` at the first differing character, which would
silently reset the counter to the wrong (too-low) value wherever old- and
new-format numbers coexist for the same prefix.

## Common mix-ups

- **"I set Last Used Seq lower than it was and got an error."** — expected;
  the system refuses to move a counter backwards below assets that
  genuinely already exist, to avoid ever re-issuing a number that's already
  on a real unit.
- **"The preview number doesn't match what I expect."** — check the Year
  Suffix field; an empty suffix falls back to the *current calendar year's*
  last two digits for the preview, which may not match what you intended if
  you're pre-configuring next year's series early.
- **"Could an employee break this by hitting the API directly?"** — in
  principle yes, per the gap noted above (the write endpoints don't check
  role server-side); in practice this requires calling the API outside the
  normal UI, since the tab itself is never shown to non-owners.
