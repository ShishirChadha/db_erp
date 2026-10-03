---
slug: correct-someones-attendance
title: Correcting someone's attendance
kind: process
audience: [owner, manager]
module: attendance
routes: [/dashboard/attendance]
keywords: [hazri theek karna, correction, galat hazri, mark absent, mark present,
  missing punch out, punch void, half day lagana, attendance change, forgot to punch]
sources:
  - apps/erp/app/api/attendance/[id]/route.ts
  - apps/erp/app/api/attendance/punches/[id]/void/route.ts
  - apps/erp/app/api/attendance/punch/route.ts
  - apps/erp/components/attendance/CorrectDayDialog.tsx
updated: 2026-10-03
---

## What this is

Fixing a day's record: someone forgot to punch, punched twice, was marked absent but
was actually in, or worked away from the shop. Needs the `attendance` page-edit grant
*and* owner/manager role. Every correction requires a written reason and is logged.

## Steps

1. Attendance → **Register**, and pick the date. (**Today** is the same view pinned to
   today.)
2. Click the pencil on the person's row. The dialog shows what the system derived, the
   full punch log for that day, and the override controls.
3. Type a **reason** — it is required, and it gates everything below it.
4. Then either:
   - **Set status** and save, to override the day (present, half day, absent, leave,
     week off, holiday, on duty); or
   - **Void** a specific punch, if a tap was wrong or duplicated; or
   - **Revert to punch log**, to undo a previous override.

## What voiding a punch does

It does *not* delete it. The punch stays on the record, struck through, with your
reason attached — permanently. It simply stops counting toward the day's hours, which
are recalculated immediately. This is deliberate: the original tap is evidence, and an
attendance record you can quietly rewrite is worth little. Voids are recorded in the
audit log at *major* severity.

## Why an override "sticks"

Once you set a status by hand, the day is marked as manually decided, and **nothing
recalculates it afterwards** — not a later punch, not the nightly scan, not an
approved leave. That is the point: your correction is the answer.

The hours, lateness and overtime figures *do* keep updating from the punch log, so you
can still see what actually happened underneath your override.

To hand the day back to the punch log, use **Revert to punch log**.

## Recording a punch for someone else

Use this when a staff member has no login, or forgot to punch entirely. It goes through
the same punch endpoint but requires a reason, is tagged as a supervisor action, and is
exempt from the office-network restriction — so you can fix a record from home.

## Precedence, when two things disagree

A manual mark beats an approved leave for the same day. Approving leave over a day you
have already marked by hand leaves your mark alone. Everything else — a derived day, a
week off, a holiday — yields to an approved leave.

## Related

**attendance**, **punch-in-and-out**, **approve-or-reject-leave**,
**set-up-shifts-work-week-and-holidays**.
