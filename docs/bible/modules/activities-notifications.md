---
slug: activities-notifications
title: Activities (Task Hub) & Notifications
kind: module
audience: [owner, manager, employee]
routes: [/dashboard/activities, /dashboard/pending-tasks]
keywords: [task, activity, notification, reminder, mention, comment, due date, assign, kaam]
sources:
  - apps/erp/app/api/activities/**
  - apps/erp/lib/notifications.ts
  - apps/erp/lib/activities.ts
updated: 2026-09-01
---

## `activities` is the single reusable task/collaboration model

Any module that needs a "someone should do X" item creates an `activities` row
(optionally linked to a business record via `related_type`/`related_id`) —
never a new per-module task table. `related_type` gained `recurring_expense`
on 2026-09-01: `scan_recurring_expenses()` (a `pg_cron` job, see **expenses**)
creates one of these when a recurring-expense rule comes due, linking
`related_id` to the rule, not to a real `expenses` row (which doesn't exist
until someone actually logs it). Supports assignment, shared visibility,
comments with @mentions, checklists, attachments, reactions/pinning, and
`pg_cron`-driven due-soon/overdue reminders (in-app only, not emailed).

`@mentions` are restricted server-side to users who can already see the task
(creator/assignee/owner) — a mention never grants implicit access to someone
who couldn't otherwise see it.

## Pending Tasks is derived, not stored

`/dashboard/pending-tasks` is a computed-live checklist from other tables
(POs without invoices, sales without payments, etc.) — it is **not** part of
the `activities` system and has no table of its own.

## Notifications go through one generic table

`notifications`, keyed by `recipient_id` — never a per-module notifier.
`lib/notifications.ts`'s `notify()`/`notifyMany()` is the one entry point;
email is best-effort (`emailBestEffort`).

## Related

**business-rules** (tasks never carry cost/vendor/margin), every other module
(anything can spawn a task).
