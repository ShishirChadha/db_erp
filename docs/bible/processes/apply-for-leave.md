---
slug: apply-for-leave
title: Applying for leave
kind: process
audience: [owner, manager, employee]
module: attendance
routes: [/dashboard/attendance]
keywords: [chutti lena, chutti ki application, leave lagana, leave apply, sick leave,
  casual leave, unpaid leave, comp off, half day leave, aadha din chutti]
sources:
  - apps/erp/app/api/leave-requests/route.ts
  - apps/erp/app/api/leave-requests/[id]/route.ts
  - apps/erp/components/attendance/NewLeaveRequestDialog.tsx
updated: 2026-10-03
---

## What this is

Asking for time off. Anyone on the roster with a login can file their own; a supervisor
files on behalf of staff without a login.

## Steps

1. Attendance → **Leave** → **Apply for leave**.
2. Pick the **type** (casual, sick, unpaid, comp off, other).
3. Pick the **duration**: full days, or first/second half. A half-day leave must be a
   single day.
4. Pick the dates and optionally give a reason.
5. Submit. The owner (and any manager who can edit attendance) gets a task in the
   Activity Hub and a notification.

## Notes

- **Weekly offs and shop holidays inside the range are not counted as leave.** Asking
  for Friday to Sunday with Sunday off consumes two days, not three.
- Two live requests cannot cover the same dates for the same person. A rejected or
  cancelled one does not block re-applying.
- You can **cancel** your own request while it is still pending. Once approved, only
  the owner can undo it, because attendance days have already been written.
- Filing for someone else needs the `attendance` edit grant, and is the only way an
  account-less staff member's leave gets recorded.
- There are **no leave balances or entitlements** in this system. A request is not
  checked against an allowance; approval is a judgement call.

## Related

**attendance**, **approve-or-reject-leave**, **activities-notifications**.
