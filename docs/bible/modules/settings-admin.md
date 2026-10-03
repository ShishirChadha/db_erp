---
slug: settings-admin
title: Settings & Admin
kind: module
audience: [owner]
routes: [/dashboard/settings]
keywords: [settings, admin, configure, dropdown options, users, business profiles, tags, sku categories, digests]
sources:
  - apps/erp/app/dashboard/settings/page.tsx
updated: 2026-10-03
---

## What lives here

All owner-only configuration, tab by tab: Asset Numbering, Dropdown Options
(`custom_options`, see **inventory-sku**), SKU Category Templates (see
**inventory-sku**), Business Profiles, Users (roles + page/edit grants, see
**roles-permissions**), Activity Tags, Website Admin (see **website**), Field
Redaction (see **roles-permissions**), Digests.

## Generic owner-curated dropdown pattern

CPU, RAM, storage, staff names, and any similar picklist live in one
`custom_options` table (never a new table per list type), managed here, read
via `lib/useCustomOptions.ts` + `components/SearchableSelect.tsx`. New
dropdown types should follow this pattern.

## Related

**roles-permissions**, **inventory-sku**, **website**.

## System Health

A new owner-only page at `/dashboard/monitoring` shows the state of the server,
both internet links, the Supabase stack, backups and the database, with
thresholds for what is normal and explicit guidance on when a restart is
needed. See `system-health.md` and `restart-or-recover-the-server.md`.

## Attendance & Staff (2026-10-03)

A new owner-only tab with four sections, configured together when the module is first
set up:

- **Shifts** — times, grace minutes (which only decide the "late" flag), half-day and
  full-day worked-minute thresholds, and weekly offs. A shift is a record with several
  numeric attributes that SQL joins to, which is why it is a table rather than a
  `custom_options` list.
- **Staff roster** — the `staff` table. Separate from the login list on purpose; most
  staff have no account. Linking a login here is what lets that person punch.
- **Office networks** — the IP allowlist and its master toggle for self-service
  punching. The toggle itself *is* a single `custom_options` row
  (`attendance_settings`), which is genuinely the flat-pick-list case that rule covers.
- **Shop holidays** — writes `festival_calendar.is_business_holiday`. Deliberately the
  only field this route touches; a festival's name and date still belong to the
  Marketing tab.

See **attendance**, **set-up-shifts-work-week-and-holidays** and
**configure-office-punch-networks**.
