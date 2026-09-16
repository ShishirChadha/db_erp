---
slug: back-up-and-restore
title: Backing up and restoring the database
kind: process
module: settings-admin
audience: [owner]
routes: [/dashboard/settings]
keywords: [backup, restore, snapshot, backup schedule, download backup, backup now, selective restore, restore preview, undo restore, safety snapshot, data loss recovery, database backup, backup lena, restore karna]
sources:
  - apps/erp/app/dashboard/settings/backup/RestorePanel.tsx
  - apps/erp/app/dashboard/settings/backup/page.tsx
  - apps/erp/app/api/backup/route.ts
  - apps/erp/app/api/backup/run/route.ts
  - apps/erp/app/api/backup/restore/preview/route.ts
  - apps/erp/app/api/backup/restore/apply/route.ts
  - apps/erp/app/api/settings/backup-schedule/route.ts
updated: 2026-09-16
---

## What this is

Settings → Backup is a self-contained backup/restore system built on top of
the live database itself (via a `generate_backup_snapshot` RPC and a
`backup_snapshots` history table), not an external tool. It covers four
things: a recurring schedule, an on-demand manual backup, a downloadable
history of past snapshots, and — the part most worth understanding
carefully — a **selective, diff-based restore**, not an all-or-nothing one.

## Who can do this

Owner only. The page itself is wrapped in `RequireOwner`, and every backing
route (`GET /api/backup`, `POST /api/backup/run`,
`GET`/`PUT /api/settings/backup-schedule`,
`POST /api/backup/restore/preview`, `POST /api/backup/restore/apply`)
independently checks `isOwner(sessionUser)` and returns 403 otherwise.

## Steps — scheduled backups

1. Open **Settings → Backup**, **Schedule** section.
2. Check **Enable scheduled backups**.
3. Choose **Daily** or **Weekly** (weekly adds a day-of-week picker) and an
   hour of day, shown/entered in the fixed timezone the system supports
   (`Asia/Kolkata` today, with `UTC` also defined — the route converts your
   local hour to a UTC cron expression at save time, since only a small
   fixed offset table is supported rather than a full timezone library; a
   DST-observing zone would need re-saving twice a year, but neither
   supported zone observes DST).
4. Pick which **modules** to back up: `full` (everything) or any combination
   of `sales`, `purchases`, `inventory`, `repairs`, `customers_vendors`,
   `invoices_quotations`. Selecting `full` clears/disables the individual
   module checkboxes since it already covers them.
5. Set **Keep last N** scheduled backups (1–100) — older scheduled snapshots
   beyond this count are pruned by retention.
6. Click **Save Schedule**.

## Steps — manual backup ("Backup Now")

1. In the **Backup Now** section, pick modules the same way as the
   schedule form.
2. Click **Backup Now**. This calls the same `generate_backup_snapshot` RPC
   directly (`trigger_type = 'manual'`), synchronously, and the new snapshot
   appears at the top of **History** immediately.

## Steps — downloading a backup

In **History**, any snapshot with `status = complete` has a **Download**
link (`GET /api/backup/[id]/download`) that saves the full JSON payload
locally. A scheduled backup that hasn't been downloaded yet is flagged with
a **"new"** badge in the list.

## Steps — restoring from a backup file

This is a three-stage flow: **upload → preview diff → selectively apply**.
It is never a blind overwrite.

1. In the **Restore** section, choose a previously downloaded backup JSON
   file.
2. The file is parsed client-side and sent to
   `POST /api/backup/restore/preview`, which — for every table present in
   the file — fetches the corresponding **live** rows by id and computes,
   per row:
   - **toInsert** — an id in the file that doesn't exist live yet (shown as
     a green **"new"** tag).
   - **toUpdate** — an id that exists live but with different field values
     (shown as an amber **"changed"** tag, expandable to see each
     `field: old → new` diff).
   - **unchangedCount** — rows identical to live, not shown individually.
   - **dbOnlyCount** — live rows the uploaded file never mentions at all;
     these are always left alone, never touched by a restore.
   Trigger-derived columns (`sku_master.quantity_in_stock`,
   `sales.amount_paid`/`payment_status`) and audit columns
   (`created_at`/`created_by`/`updated_at`/`updated_by`) are excluded from
   the diff entirely — they're expected to differ and would otherwise
   always show as a false "change."
3. Every **new** and **changed** row is **pre-selected** (checked) by
   default; unchanged and db-only rows are never selectable at all — there's
   nothing to restore for them. Uncheck anything you don't want applied, per
   row or per table ("Select all" toggles a whole table's rows at once).
4. Click **Review & Apply (N selected)**, confirm in the dialog (which
   lists exactly how many records per table are about to be written), then
   **Confirm & Apply**.
5. The apply endpoint (`POST /api/backup/restore/apply`) re-validates that
   every submitted id actually exists in the uploaded payload for that
   table (rejecting a tampered request), then calls the
   `apply_backup_restore` RPC.

## Restore is selective and additive — not all-or-nothing

This is the single most important nuance of this feature: **a restore never
deletes anything, and it only ever touches the rows you explicitly checked
in the preview.** It is not "roll the database back to this snapshot" in
the usual sense — it's "insert these specific new rows and update these
specific existing rows I selected, from this file, leaving everything else
in the live database exactly as it is." A restore that only selects one
table's rows leaves every other table completely untouched, even if the
uploaded file contains data for them.

## Every restore takes its own safety snapshot first

Before applying any selected restore, the system automatically takes a full
safety snapshot of the *current* live database
(`trigger_type = 'pre_restore_safety'`) — this is what the confirmation
dialog and the success banner both reference ("A full safety snapshot of
the current database will be taken first, so this can be undone by
restoring it again"). If a restore turns out to be wrong, the fix is to
download that pre-restore safety snapshot from History and restore from it
the same way.

## Common mix-ups

- **"I restored a file and now some old data came back that I didn't
  expect."** — check exactly which rows you selected in the preview step;
  if a table's "Select all" was left checked, every changed row in that
  table (not just the ones you meant to fix) got applied.
- **"Will this restore delete rows that only exist in the live database
  now?"** — no, never. `dbOnlyCount` rows are explicitly left untouched;
  this system has no delete path at all.
- **"I need to undo a restore I just did."** — restore the automatic
  pre-restore safety snapshot that was taken right before it, from
  **History**.
- **"The schedule says 9pm but it ran at a different time."** — the saved
  hour is your local (`Asia/Kolkata`) hour converted once to a UTC cron
  expression at save time; if that ever needs to shift for DST-like
  reasons, re-save the schedule.
