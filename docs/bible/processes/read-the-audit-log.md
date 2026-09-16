---
slug: read-the-audit-log
title: Reading and acting on the audit log
kind: process
audience: [owner, manager, employee]
module: backup-audit
routes: [/dashboard/settings, /dashboard/settings/audit-log]
keywords: [audit log, audit trail, who changed this, history, restore soft delete, revert, field correction, undo, recover, activity log, kisne badla]
sources:
  - apps/erp/app/dashboard/settings/audit-log/page.tsx
  - apps/erp/app/dashboard/settings/page.tsx
  - apps/erp/app/api/audit-log/route.ts
  - apps/erp/app/api/audit-log/[id]/restore-soft-delete/route.ts
  - apps/erp/app/api/audit-log/[id]/restore-hard-delete/route.ts
  - apps/erp/app/api/audit-log/field-corrections/[correctionId]/revert/route.ts
  - apps/erp/lib/audit-log-restore.ts
updated: 2026-09-16
---

## What this is

A row-per-action trail across every module (`audit_log` table, written via
`logAuditEvent()`), reachable from **Settings → Audit Log**
(`category=audit_log` on `/dashboard/settings`; the standalone
`/dashboard/settings/audit-log` route still works directly, it's just no
longer a separate sidebar item). Every create, update, status change,
soft-delete, hard-delete, void, and login/logout event across modules like
sales, stock, purchase orders, SKU master, repair jobs, RMA, customers,
vendors, invoices, activities, and settings lands here. This chapter covers
reading/filtering the log and the two narrow, row-scoped recovery actions
available directly from a log entry. It does **not** cover the separate
full backup/restore system — see **back-up-and-restore** for that; they
are deliberately different mechanisms (a database-wide snapshot/restore
tool vs. this per-record trail with targeted undo).

## Who can do this

Any signed-in staff member can open Audit Log — the Settings page itself
is open to every role, and this tab is one of the few not marked
`ownerOnly`. What you see differs by role:

- **Owner** sees every user's audit trail, with a **User** column showing
  `actor_email`/`actor_id`, and can filter by any actor.
- **Everyone else** is hard-restricted server-side to **their own** rows
  only (`GET /api/audit-log` forces `actor_id = sessionUser.id` for any
  non-owner, ignoring any `actor_id` filter they might pass) — there is no
  way for a non-owner to see someone else's trail from this page.

The two recovery actions below (**Restore** and **Revert**) are **owner-only**
regardless of whose row it is — both routes return 403 for a non-owner even
though they might be looking at their own audit entry.

## Steps — filter and read entries

1. Open **Settings → Audit Log**.
2. Filter by **Module** (sales, stock, purchase_orders, sku_master,
   repair_jobs, replacement_jobs, rma, customers, vendors, invoices,
   activities, settings, auth), **Action** (Created / Updated / Status
   changed / Deleted / Restored / Permanently deleted / Voided / Signed
   in / Sign-in failed / Signed out), and a date range.
3. Click a row to expand it. The expanded panel shows the entry's
   **reason** (if logged), any **field changes** attached to it (an
   update-type event's before/after diff, sourced from `field_corrections`
   rows referenced by `field_correction_ids`), and — for a deletion —
   whether it's currently restorable, already restored, or a prior restore
   attempt failed.

A field hidden from your role by the redaction rules (e.g. `cost_price`
for an employee) is **dropped from the diff entirely**, not masked — you
won't see a redacted line at all, the same "don't fetch it, don't show it"
principle used elsewhere in the app.

## Steps — restore a soft-deleted record (owner only)

A **soft-delete** entry (`action_type = 'soft_delete'`) is a record that
was flagged deleted (`is_deleted = true`, or for `sku_master`,
`status = 'archived'`) but never actually removed from the database — sales,
vendors, purchase orders, customers, invoices, expenses, asset_ledger
rows, sales_documents, activities, activity_comments, sku_master, and
profiles all use this pattern.

1. Expand a `soft_delete` entry whose restore status shows **restorable**.
2. Click **Restore**. This calls
   `POST /api/audit-log/[id]/restore-soft-delete`, which simply flips the
   same flag back (`is_deleted = false`, or `status = 'active'` for
   `sku_master`) and logs a new `restore` audit event referencing the
   original one. The entry's own `restore_status` becomes `restored` so
   the button won't offer to restore it again.

## Steps — attempt to restore a hard-deleted record (owner only)

A **hard-delete** entry (`action_type = 'hard_delete'`) is a record that
was actually removed from the database, but a snapshot of it was captured
at delete time. This UI deliberately labels the action **"Attempt
Restore"**, not "Restore" — it is best-effort and can fail cleanly (e.g. a
serial/asset number was since reused, or a related row it depends on has
since changed). Today this only has real handlers for `asset_ledger`,
`purchase_orders` (re-inserting the PO, its items, any associated
`asset_ledger` rows, and a compensating `stock_movements` reversal row),
`sale_payments`, and `vendor_payments` — every one re-inserts rows with
their **original ids/numbers** rather than minting new ones (this does not
claw back `asset_counters`/`po_counter`, which stay one-way by design, the
same as everywhere else in the app). A table with no handler, or an entry
whose `restore_status` isn't `restorable`, returns an error instead.

## Steps — revert a single field correction (owner only)

Inside an entry's **Field changes** list, each line shows one field's
`old_value → new_value`. Click **Revert** next to a specific field to call
`POST /api/audit-log/field-corrections/[correctionId]/revert`, which writes
that field back to its `old_value` on the live record and logs a new
`restore` event. This is scoped to exactly one field on one record — it
does not touch any other field that entry's update may have also changed;
revert each field line separately if you need to undo more than one.

Not every field can be reverted this way: `old_value`/`new_value` are
stored as stringified text, so writing that string back verbatim would
corrupt a jsonb/array column. A fixed blocklist
(`bundled_accessories`, `specifications`, `field_schema`, `allowed_pages`,
`tags`, `mentioned_user_ids`, `attachments`, `selected_upgrades`,
`metadata`) is refused outright with "can't be safely auto-reverted — edit
it manually" rather than guessed at.

## Common mix-ups

- **"I don't see a Restore/Revert button."** — both actions are owner-only;
  a non-owner can read every detail of their own entries but never gets
  the action buttons, even on their own row.
- **"Restore vs. Revert — which do I want?"** — **Restore** undoes an
  entire deleted record (soft or hard); **Revert** undoes one specific
  field's value on a record that still exists. They're not interchangeable.
- **"My hard-delete restore failed."** — this is expected behavior for
  some cases, not a bug — the entry's `restore_status` flips to
  `restore_failed` and the confirmation dialog already warns this is
  best-effort (e.g. a reused serial/asset number, or a dependency that
  changed since deletion).
- **"This isn't the same as the Backup page."** — correct, and
  intentionally so: this is a per-record trail with narrow, targeted undo
  actions; **back-up-and-restore** covers the separate database-wide
  snapshot/selective-restore system.
