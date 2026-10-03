---
slug: approve-or-reject-leave
title: Approving or rejecting leave
kind: process
audience: [owner, manager]
module: attendance
routes: [/dashboard/attendance, /dashboard/activities]
keywords: [chutti approve karna, leave manzoor, leave approve, reject, leave reject,
  leave decide, chutti mana karna]
sources:
  - apps/erp/app/api/leave-requests/[id]/decide/route.ts
  - apps/erp/components/attendance/ApproveLeaveDialog.tsx
updated: 2026-10-03
---

## What this is

Deciding a pending leave request. Needs the `attendance` page-edit grant and
owner/manager role.

## Steps

1. Either open the task from the Activity Hub (or its notification), or go to
   Attendance → **Leave** and filter to **Pending**.
2. Click **Decide**.
3. Optionally add a note, then **Approve** or **Reject**. The person who filed it is
   notified either way, and the approval task closes.

## What approving actually writes

Each working day in the range is written onto the register as **leave**, skipping
weekly offs and shop holidays, and skipping any day a supervisor has already marked by
hand (they were there, and someone recorded it).

The whole decision is one database transaction, so it cannot half-apply. It is also
claimed atomically twice over: once on the request still being pending, once on the
days not already having been written. A double-click, a retry, or two managers deciding
at the same moment therefore produces **exactly one** decision and **one** set of days
— the second attempt is told the request was already decided.

## Undoing an approval

Owner-only. Cancelling an already-approved request releases the days it wrote and
recalculates them from the punch log. Days that have since been marked manually are
left untouched.

## Related

**attendance**, **apply-for-leave**, **correct-someones-attendance**,
**activities-notifications**.
