---
slug: attendance
title: Attendance & Leave
kind: module
audience: [owner, manager, employee]
routes: ['/dashboard/attendance']
keywords: [attendance, hazri, haazri, hazari, hazri register, chutti, chhutti, leave,
  leave request, leave lagana, punch in, punch out, punch karna, aana jaana, late,
  late aana, half day, aadha din, absent, gair hazir, present, overtime, OT, shift,
  duty, duty time, week off, weekly off, holiday, shop band, staff, employee,
  monthly attendance, roster, office ip, punch nahi ho raha]
sources:
  - apps/erp/app/api/attendance/**
  - apps/erp/app/api/staff/**
  - apps/erp/app/api/leave-requests/**
  - apps/erp/app/api/settings/attendance-shifts/**
  - apps/erp/app/api/settings/attendance-networks/**
  - apps/erp/app/api/settings/attendance-holidays/**
  - apps/erp/app/dashboard/attendance/**
  - apps/erp/components/attendance/**
  - apps/erp/components/PunchWidget.tsx
  - apps/erp/components/AttendanceSettingsManager.tsx
  - apps/erp/lib/attendance.ts
  - apps/erp/lib/attendance-server.ts
  - apps/erp/lib/attendance-network.ts
  - apps/erp/lib/useMyAttendance.ts
updated: 2026-10-03
---

## What this covers

Daily attendance for shop staff: who was in, when, for how long, who was late, who
was on leave, and which days the shop was shut. Staff with a login punch their own
card; the owner or a manager marks and corrects anyone. Leave is requested and
approved through the existing Activity Hub. There is deliberately **no payroll or
money output** in this module.

## The staff roster is not the login list

`staff` is the canonical employee roster and it is **separate from `profiles`**. A
profile *is* a login (an `auth.users` row, page grants, device sessions), and most of
this shop's staff have no login and never will — so roster membership could not be a
profiles row. `staff.profile_id` links a roster row to a login *when there is one*,
and is NULL otherwise.

A staff member with no `profile_id`:

- cannot punch (there is no session to resolve from),
- cannot file their own leave (a supervisor files it on their behalf),
- is invisible to the own-only RLS self-read,
- is marked and corrected by a supervisor on the register.

That falls out of the data rather than being special-cased: the self-read policy
matches on `profile_id = auth.uid()`, which a NULL can never satisfy.

`staff` is also **additive**. `custom_options.staff_names` — the free-text list behind
`sales.sold_by` and `expenses.paid_by_staff` — is deliberately unchanged and was NOT
migrated. `staff.legacy_staff_name` records the mapping for a possible future
consolidation and **nothing reads it today**. Do not assume a migration happened.

## A "day" is the IST calendar day

The business is in India; the database and pg_cron run in UTC. `attendance_punches`
carries a `work_date` stamped by `trg_attendance_punches_work_date` as
`(punched_at AT TIME ZONE 'Asia/Kolkata')::date`, and **everything downstream keys off
it**. This matters concretely:

- A punch at 21:30 IST is 16:00 UTC the *same* day — fine either way.
- A punch at 00:30 IST is 19:00 UTC the *previous* day. A naive `punched_at::date`
  would file it under the wrong date.
- A **punch-out inherits its open punch-in's `work_date`** (18-hour lookback), so
  closing a shift at 01:00 IST closes the previous evening's record instead of opening
  a phantom one for the new day.

This cannot be a generated column: `AT TIME ZONE` is `STABLE`, not `IMMUTABLE`, and
Postgres rejects a non-immutable generated expression. Hence the trigger — which is
also what makes the punch-out inheritance possible.

The nightly scan derives "yesterday" from `Asia/Kolkata` too, **never from
`current_date`**: it runs at 22:15 UTC, where the two differ by a day.

## Punches are append-only; a correction never erases anything

`attendance_punches` is a ledger, the same posture as `sale_payments` and
`expense_reimbursements`. A row is never edited or deleted. A supervisor correction is
**a new row plus a void** (`voided_at`/`voided_by`/`void_reason`) on the one it
replaces, so the original tap survives forever and the correction dialog shows it
struck through. Voids are audited as `void`, which lands in the audit log's *major*
severity bucket.

`attendance_days` is the derived one-row-per-person-per-day summary, written by
`recompute_attendance_day()` off the punch log — the
`sale_payments` → `sync_sale_payment_totals` → `sales.amount_paid` relationship
transplanted. Never write `worked_minutes` or the other derived columns from
application code; insert a punch instead.

`worked_minutes` is the **sum over matched in/out pairs**, not `last_out - first_in`,
so a lunch punch-out is not counted as worked time.

## Late and overtime are minutes, not statuses

`status` is one of `present, half_day, absent, leave, holiday, week_off, on_duty`.
Lateness, early exit and overtime are **separate integer-minute columns**, because
"present but 40 minutes late" has to be representable — folding it into the status
would collide with `half_day`. The shift's `grace_minutes` only decides the `is_late`
flag; `late_minutes` is recorded from minute one either way.

Present / half-day / absent is decided by worked minutes against the shift's
`full_day_min_minutes` and `half_day_min_minutes` thresholds.

## `status_source` is the override guard

Every `attendance_days` row records *who decided its status*: `derived`, `manual`,
`leave`, `holiday` or `week_off`. `recompute_attendance_day()` **only rewrites `status`
when `status_source = 'derived'`**.

That single rule is what stops a later punch, a trigger re-fire, the nightly scan or an
approved leave from silently undoing a supervisor's correction. The derived *minute*
columns refresh regardless, so a manually-marked day still shows the real punch data.
Reverting an override sets the source back to `derived` and recomputes.

Precedence, when two things want the same day: a **manual** mark wins over an approved
leave (someone was physically there and recorded it); everything else yields to the
approval.

## Leave

A `leave_requests` row plus an `activities` row with `related_type = 'leave_request'`,
assigned to the approvers with a `task_assigned` notification. **No per-module task
table and no per-module notifier** — and no new notification type, since
`task_assigned`/`status_changed` already fit.

Approval is one RPC, `decide_leave_request()`, so the status flip and the day writes
are a single transaction. It carries **two independent atomic claims** — one on
`status = 'pending'`, one on `applied_at IS NULL` — so a double-click, a retry or two
managers racing can only ever produce one decision and one set of days. The loser gets
a 409.

Weekly offs and shop holidays inside the range are **skipped**, not consumed as leave.
Undoing an approved leave is owner-only and goes through `revoke_leave_from_days()`,
which releases only the days that request still owns and recomputes them.

## Holidays and the work week

Shop closures live on **`festival_calendar.is_business_holiday`**, not a second table.
The flag defaults to `false` because most rows there are marketing-content reference
festivals the shop stays *open* on. A non-festival closure (stock-take, painting) is an
ordinary row with `is_major = false, is_business_holiday = true`.

Cross-module consequence: **deleting a festival row from the Marketing tab also removes
it as a shop holiday.**

The work week is `staff_shifts.weekly_off_days` (ISO 1=Mon..7=Sun) with an optional
per-person `staff.weekly_off_days` override — NULL inherits the shift's, an empty array
means no weekly off at all.

## Punching from the office network only

Self-service punching can be restricted to an owner-managed allowlist of IPs/CIDR
ranges (`attendance_networks`), gated by a master toggle. Containment is tested with
Postgres `inet` operators, never hand-rolled in JS.

Three things worth knowing:

- **It fails OPEN** when the toggle is on but no active range exists, so an empty list
  can never lock the whole shop out. The Settings tab warns loudly in that state.
- **Supervisor marking and corrections are exempt**, so the owner can fix a record from
  home. They are already role-gated, reason-required and audited.
- **It is a deterrent, not a guarantee.** The client IP is only as trustworthy as the
  proxy that sets the header; see **configure-office-punch-networks** for the honest
  limits. A blocked attempt writes **no punch row** but *is* recorded in the audit log
  as `blocked`, with both the trusted IP and the untrusted observed one.

## Who sees what

An employee sees **only their own** attendance, punches and leave. Owners and managers
see everyone. The clamp lives in `resolveVisibleStaffIds()` and is applied by every
list and summary route; a `staff_id` naming someone else is **ignored, not rejected**,
so the endpoints cannot be used as an existence oracle.

See-all is gated on **role** (`isManagerOrAbove`), not on the page key. The `attendance`
page key gates reaching the register at all.

**Punching your own card needs no page key.** Requiring one would be a setup trap — a
new staff member could log in and have Punch In silently 403 until someone ticked a
box. The authorization is structural instead: `getMyStaffRow()` resolves at most one
roster row, your own. Seeing the register, anyone else's data or the monthly summary
does need the key.

RLS on these tables is defense-in-depth only: every app read goes through
`supabaseAdmin`, which bypasses it. **The API layer is the real own-only boundary**,
which is why it is verified over HTTP rather than against the database.

## Not covered yet

Payroll or salary output of any kind, the `on_duty` status in the UI (the value exists
and is supervisor-settable but has no dedicated screen), a morning "not punched in yet"
nudge, biometric or geofenced punching, leave balances and accrual (a request is not
checked against an entitlement), and CSV export of the monthly grid.

## Related

**activities-notifications** (leave approval and the missing-punch-out nudge are
ordinary activities), **settings-admin** (the Attendance & Staff tab: shifts, roster,
networks, closures), **marketing** (shares `festival_calendar` — a deleted festival
changes attendance), **roles-permissions** (the `attendance` key and the punch
exception), **business-rules** (append-only ledgers, derived-not-stored, atomic
claims), **backup-audit** (the `attendance` audit module and the `blocked` action).
