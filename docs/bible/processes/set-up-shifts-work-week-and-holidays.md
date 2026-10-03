---
slug: set-up-shifts-work-week-and-holidays
title: Setting up shifts, the work week and shop holidays
kind: process
audience: [owner]
module: attendance
routes: [/dashboard/settings]
keywords: [shift time, duty time, shift banana, weekly off, week off, chutti ka din,
  festival holiday, shop band, holiday lagana, grace time, late margin, staff roster,
  employee add karna, half day setting]
sources:
  - apps/erp/app/api/settings/attendance-shifts/route.ts
  - apps/erp/app/api/settings/attendance-shifts/[id]/route.ts
  - apps/erp/app/api/settings/attendance-holidays/route.ts
  - apps/erp/app/api/staff/route.ts
  - apps/erp/app/api/staff/[id]/route.ts
  - apps/erp/components/AttendanceSettingsManager.tsx
updated: 2026-10-03
---

## What this is

First-time setup for attendance, and ongoing roster changes. Owner-only, in
Settings → **Attendance & Staff**.

## Steps

1. **Shifts** — add at least one. You set:
   - start and end time (shop wall-clock),
   - **grace** minutes, which only decides whether a day is flagged "late" (lateness in
     minutes is recorded from minute one regardless),
   - **half-day** and **full-day** minimum worked minutes, which decide whether a day
     reads as absent, half day or present,
   - the **weekly off** days for that shift.
2. **Staff roster** — add each person: name, employee code, phone, join date, default
   shift. Link a **login** only for staff who have one; leave it as *No login*
   otherwise. You can override an individual's weekly off here, or leave it inheriting
   the shift's.
3. **Office networks** — optional; see **configure-office-punch-networks**.
4. **Shop holidays** — tick "Shop closed" against a festival, or add a non-festival
   closure (stock-take, painting). On a closure, staff are marked **holiday** instead of
   absent, and leave is not consumed.

## Notes

- The roster is **separate from the login list**, on purpose: most staff here have no
  account. Adding someone to the roster does not create a login, and does not add them
  to the "Sold By" name list either.
- Removing a staff member keeps their attendance history, and frees their employee code
  for reuse.
- Deactivating a shift keeps it on past records — it is never deleted, so historical
  days still show which schedule they were judged against.
- Holidays live on the **same festival calendar Marketing uses**. Most festivals there
  are *not* closures unless ticked. Conversely, deleting a festival from the Marketing
  tab also removes it as a shop holiday.
- A new staff member is not expected on the register before their **join date**.

## Related

**attendance**, **configure-office-punch-networks**, **settings-admin**,
**marketing**.
