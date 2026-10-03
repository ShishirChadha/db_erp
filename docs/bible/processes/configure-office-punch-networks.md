---
slug: configure-office-punch-networks
title: Restricting punching to the office network
kind: process
audience: [owner]
module: attendance
routes: [/dashboard/settings]
keywords: [office ip, office network, wifi, shop wifi, punch nahi ho raha, blocked,
  punch from home, ghar se punch, mobile data punch, ip address, cidr, geofence]
sources:
  - apps/erp/lib/attendance-network.ts
  - apps/erp/app/api/settings/attendance-networks/route.ts
  - apps/erp/app/api/settings/attendance-networks/[id]/route.ts
  - apps/erp/app/api/attendance/my-ip/route.ts
  - apps/erp/app/api/attendance/punch/route.ts
updated: 2026-10-03
---

## What this is

Stopping staff from punching in without being at the shop. Owner-only, in
Settings → Attendance & Staff → **Office networks**.

## Steps

1. Open this page **from the shop's wifi**.
2. Click **Use this device's IP**, give it a label ("Shop wifi"), and add it. For a
   range, enter CIDR notation such as `49.36.12.0/24`.
3. Tick **Only allow punching from the office network**.

## What it does and does not do

- It applies **only to staff punching their own card**. You and your managers can still
  mark and correct attendance from anywhere — those actions already require a reason
  and are logged.
- A refused punch records **nothing** on the register. The attempt *is* written to the
  audit log, with the IP it came from, so a pattern of trying from outside is visible
  in Settings → Audit Log.
- **It is a deterrent, not a guarantee.** Be clear-eyed about this: the system learns a
  visitor's IP from information the browser's connection supplies, and a determined
  person with technical knowledge can misrepresent it. It reliably stops casual
  punching from home or mobile data. It is not proof of physical presence, and it
  should not be treated as such in a dispute.

## If it is switched on but nothing is listed

Punching keeps working for everyone, and the page shows a warning. This is deliberate:
the alternative — refusing every punch — would lock the whole shop out over a
configuration slip. Add a network to make the restriction take effect.

## If punching suddenly stops working for everyone

Almost always because the broadband IP changed, which most Indian connections do from
time to time. Open this page from the shop and use **Use this device's IP** again, then
remove the stale entry. Until then you can either untick the setting or mark attendance
yourself.

## Running outside the live site

If the app is ever hosted somewhere other than its current host, it may no longer be
able to verify visitors' IPs. In that case the page says so and the setting should be
left off — switching it on would refuse everyone rather than just off-site staff. The
underlying reason and the configuration knob
(`ATTENDANCE_TRUSTED_IP_HEADER`) are documented at the top of
`apps/erp/lib/attendance-network.ts`.

## Related

**attendance**, **punch-in-and-out**, **set-up-shifts-work-week-and-holidays**,
**backup-audit**.
