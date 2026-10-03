---
slug: punch-in-and-out
title: Punching in and out
kind: process
audience: [owner, manager, employee]
module: attendance
routes: [/dashboard/attendance]
keywords: [punch in, punch out, hazri lagana, punch karna, in time, out time, aana jaana,
  attendance lagana, lunch break, punch nahi ho raha]
sources:
  - apps/erp/app/api/attendance/punch/route.ts
  - apps/erp/app/api/attendance/me/route.ts
  - apps/erp/components/PunchWidget.tsx
  - apps/erp/lib/useMyAttendance.ts
updated: 2026-10-03
---

## What this is

How a staff member records their own working hours. It needs no page permission and no
setup beyond being on the roster with a login attached.

## Steps

1. Open the ERP on your phone. The **Punch In** button sits in the top bar on every
   page, so it is one tap from wherever you are. On a computer it is at the top of the
   Attendance page and the dashboard.
2. Tap **Punch In** when you arrive. The button changes to **Punch Out · in since
   10:04**.
3. Tap **Punch Out** when you leave. You can punch out and back in as many times as
   you like in a day — only the time actually between an in and an out is counted, so
   punching out for lunch does not cost you the lunch hour as worked time.

## Notes

- You can only punch **your own** card, and only for the current moment. There is no
  way to punch for a colleague or to backdate a punch; a supervisor does that, with a
  reason, and it is logged.
- If **Punch In** is missing entirely, you are not on the staff roster yet (or your
  login is not linked to it). The owner fixes that in Settings → Attendance & Staff →
  Staff roster.
- If punching is refused with "You can only punch in or out from the office network",
  you are off the shop's wifi — see **configure-office-punch-networks**. Nothing is
  recorded, but the attempt is logged.
- Punching out twice in a row is refused, as is punching in while already in.
- A late punch-in still records you as present. Lateness is recorded separately in
  minutes; it does not change your status.

## Which day a punch belongs to

The day is the **Indian calendar day**, not the server's. An evening punch at 21:30
belongs to that day, and if you punch out after midnight it still closes *that
evening's* shift rather than starting a new day. You do not have to think about this —
it is handled when the punch is recorded.

## If you forget to punch out

The system will not invent a punch-out for you. The next morning a task is raised
("Missing punch-out") for you or the owner, and a supervisor corrects the record from
Attendance → Register. See **correct-someones-attendance**.

## Related

**attendance**, **correct-someones-attendance**,
**configure-office-punch-networks**, **apply-for-leave**.
