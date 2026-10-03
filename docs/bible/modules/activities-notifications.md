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
updated: 2026-10-03
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

## Rental reminders

`activities.related_type` accepts `'rental_agreement'`. The `scan_rental_cycles()`
pg_cron job (daily) raises a task plus an in-app notification when a rental billing
cycle is due or a return is overdue — reusing the generic `activities` +
`notifications` tables and the `task_assigned` type, never a rentals-specific task or
notifier table. It uses the same atomic-claim idiom as `scan_activity_due_dates()`, so
an overlapping tick cannot double-notify.

Pending Tasks gains two derived sections, **Rentals Overdue** and **Rent Due to Bill**,
computed live from agreement data — nothing about "overdue" or "due to bill" is stored.
See **rentals**.

## Attendance & leave (2026-10-03)

`related_type` gained an eleventh value, **`leave_request`**. A leave request routes its
approval through an ordinary `activities` row plus `activity_assignees` and
`notifications` — no per-module task table and no per-module notifier — and needed **no
new notification type**: the approver gets `task_assigned`, the requester gets
`status_changed` on the decision, which is exactly what the existing cron scanners
already emit.

Two attendance-specific notes:

- Assignees are inserted **directly**, not through `areValidUsers()`. That helper
  requires `'activities'` in `allowed_pages`, which would reject a manager who approves
  leave but was never granted the Activity Hub. `scan_recurring_expenses()` and
  `scan_rental_cycles()` insert theirs directly for the same reason.
- The nightly **missing punch-out** nudge leaves `related_type`/`related_id` NULL: it is
  not about a leave request, and `activities_related_pair_check` forbids a type without
  an id. Its deep link rides in `notifications.link` instead, rather than adding a
  second `related_type` value for one reminder.

Separately, `components/ActivityList.tsx` had been missing `rental_agreement` from its
local `RelatedType` union since the Rentals module shipped, so rental-linked tasks
rendered with no label. Fixed in the same pass. See **attendance**.

## Related

**business-rules** (tasks never carry cost/vendor/margin), **attendance** (leave
approval and the missing-punch-out nudge), every other module (anything can spawn a
task).
