---
slug: roles-permissions
title: Roles and permissions
kind: rule
audience: [owner, manager, employee]
routes: [/dashboard/settings]
keywords: [role, permission, access, owner, manager, employee, page access, edit grant, kaun kar sakta hai, who can, redaction rules]
sources:
  - apps/erp/lib/auth/session.ts
  - apps/erp/lib/auth/redact.ts
  - apps/erp/components/sidebar.tsx
  - apps/erp/components/RequirePageAccess.tsx
  - apps/erp/app/dashboard/home/page.tsx
  - apps/erp/lib/leads.ts
updated: 2026-10-06
---

## The three roles

- **Owner** — full access to everything, always. Never needs an explicit grant.
- **Manager** — sees cost/vendor/margin (same visibility as owner on financial
  fields) and can approve/see more than an employee, but does **not**
  automatically get edit rights on every page it can view — "sees costs,
  approves POs" is a different grant from "can edit this page."
- **Employee** — the operational, day-to-day role. Redacted from cost/vendor/
  margin (see the one accessory exception in **business-rules**). Sees only
  pages it's been explicitly granted.

## Two separate kinds of grant

1. **Page access** (`profiles.allowed_pages`) — can this person even see the
   page? Owners always yes; manager/employee need the page's key in their
   allowlist. Checked via `hasPageAccess()`.
2. **Edit grant** (`profile_page_actions`, `can_edit`) — can this person
   *change* something on a page it can already see? Owner always yes;
   manager/employee need an explicit per-page grant here too, separate from
   page access. Checked via `canEditPage()`.

Owner sets both in **Settings → Users**. For the exact current matrix, see
`generated/permissions.md` — it's built live from these two tables plus the
nav structure, so it's always accurate to what's actually configured today,
not what was configured when this chapter was last written.

The three Reconciliation pages under Finance (`/dashboard/recon/vendors`,
`/dashboard/recon/bank`, `/dashboard/recon/sessions`)
are `ownerOnly: true` at the nav level (matching Vendors/RMA/Quotations), not a
grantable `pageKey` like the rest of Finance — every one of them is cost/
vendor-bearing (an uploaded vendor invoice's cost lines, a bank transaction's
counterpart) — and every API route underneath them checks `isOwner()` directly
regardless of the nav gate. See **reconciliation** for the module itself.

**GST Returns** (`/dashboard/gst`) takes the same posture and for the same
reason: a return exposes the entity's full turnover, and the purchase side it
will grow into is cost- and vendor-bearing throughout. `ownerOnly: true` at the
nav level, and every metric on `/api/gst/returns` returns a hard 403 to a
non-owner — the page guard is UX only. See **finance-gst-reports**.

## Field redaction is a third, independent axis

Even on a page an employee can see and edit, specific *fields* can be hidden —
cost price, vendor name, margin — via `redaction_rules` (Settings → Field
Redaction), keyed by a logical shape (`sku_master`, `stock_list`, `accessories`,
`audit_log`, `vendors`) and checked per role (`hidden_from_manager` /
`hidden_from_employee`). This is what implements the cost/vendor/margin rule
from **business-rules** in a way the owner can tune without a code change.

## Where the enforcement actually lives

**Never trust the sidebar or `RequireOwner`/`RequirePageAccess` as the real
boundary** — those exist purely so a user doesn't see a menu item they can't
use; they're a UX convenience. The real check happens inside every API route
handler, via `getSessionUser()` (Bearer-token, for API routes) or
`getCookieSessionUser()` (cookie session, for server components), then
`isOwner()` / `isManagerOrAbove()` / `hasPageAccess()` / `canEditPage()`. A new
route that skips this check is a real security hole, not a cosmetic one — the
whole app runs on `supabaseAdmin` (service role), which bypasses Postgres RLS
entirely, so RLS policies are not a backstop here.

## Owner-only is about money leaving, not about seniority

Rentals is the clearest illustration of the line this app actually draws. Opening a
rental, handing units over, recording a return, raising the rent charge, a rent-to-own
buyout and closing the agreement all run on the ordinary `rentals` page-edit grant —
they are operational work, and operational work is never gated behind the owner.
Settling a **security deposit** is owner-only, because that is money going back out of
the business, the same line already drawn around correcting a sale payment.

Generating the GST invoice for a rental needs no new rule at all: it goes through the
existing owner-only sales finalize routes like every other invoice.

## A quick way to answer "can X role do Y?"

1. Is it a destructive/owner-exclusive action from **business-rules**'
   "Only the owner can" list? → owner only, full stop.
2. Otherwise, check `generated/permissions.md` for the page's current grants.
3. If it's a *field* visible/hidden question (cost, vendor, margin) rather than
   a page/action question, check the Redacted fields table in the same
   generated file.

## Self-hosted auth (since 2026-10-01)

Tokens are now signed by the self-hosted GoTrue with **ES256**, and
`session.ts` verifies them against the JWKS published at
`db.digitalbluez.com/auth/v1/.well-known/jwks.json`. The issuer must match
`https://db.digitalbluez.com/auth/v1` byte for byte.

Two consequences worth knowing:

- Changing the backend hostname invalidates every existing token, so everyone
  is signed out once and must log in again. This is expected, and looks exactly
  like a rejected password.
- A failed *network* call to the database is currently indistinguishable from
  "not signed in": `getSessionUser()` returns null either way, the route
  answers 401, and `api-client.ts` signs the user out. On a home connection
  this will eventually happen again. The proper fix is for routes to answer 503
  on a backend-unreachable error so the client retries instead of logging out.

## Attendance (2026-10-03)

New page key **`attendance`**, with both a view grant (`profiles.allowed_pages`) and an
edit grant (`profile_page_actions`). It behaves unlike the other keys in two ways worth
knowing.

**Own-only is the default, and see-all is gated on ROLE, not on the key.** An employee
holding the `attendance` view key sees only their own attendance, punches and leave —
granting the key does not expose the team. Owners and managers see everyone, via
`isManagerOrAbove`. The clamp is `resolveVisibleStaffIds()` in
`lib/attendance-server.ts`, applied by every list and summary route; a `staff_id`
naming someone else is ignored rather than rejected, so the endpoints cannot be used
as an existence oracle.

**Punching your own card deliberately needs NO page key.** `GET /api/attendance/me`
and `POST /api/attendance/punch` (self branch) require only a valid session. Requiring
the key first would be a setup trap: the owner adds a staff member, they log in, and
Punch In silently 403s until someone remembers a checkbox. The authorization is
structural instead — `getMyStaffRow()` resolves at most one roster row, the caller's
own, so there is nothing else the endpoint could act on. This is the same reasoning
that leaves Settings → Appearance and `/dashboard/help` key-free. Everything else in
the module (the register, the monthly summary, anyone else's data) does require the key.

Corrections and leave decisions require the edit grant **and** owner/manager role.
Roster, shift, network and holiday changes are owner-only. Undoing an already-approved
leave is owner-only, because attendance days have already been written.

A separate RLS helper, `is_manager_or_above()`, was added for the own-only policies —
`is_owner()` is too narrow (managers see the team) and `is_staff()` too broad (an
employee is staff). Like the other two it stays callable by `authenticated`, since it
is evaluated inside policy evaluation.

See **attendance**.

## Home (2026-10-05)

**`/dashboard/home` is the one page in this app with no `pageKey` at all** —
not "a key everyone happens to have," genuinely ungated, same reasoning as
`/dashboard/help` and the attendance self-punch endpoints. It exists because
`/dashboard` (the KPI overview) stays gated behind the `dashboard` key, since
the owner doesn't want every employee seeing business numbers — which left
staff with narrow grants landing nowhere coherent. Home is that landing spot:
the punch widget, the signed-in staff member's own roster details, and
owner-published broadcasts (`business_updates`, owner-only to post via
`POST /api/business-updates`, readable by anyone signed in via `GET` with no
page-key check — same posture as `GET /api/attendance/me`).

`RequirePageAccess`'s fallback when the `dashboard` key itself is denied is
now always `/dashboard/home`, replacing a former priority list of other
business pages — landing an employee on an arbitrary granted page read as
"there's no home for me here." Because of this fallback role, Home's sidebar
entry must stay visible to every role regardless of `allowed_pages` — hiding
it would break the one safe redirect target `RequirePageAccess` has for a
denied `dashboard` check.

## Leads (2026-10-06)

New page key **`leads`**, granted/edited exactly like any other page in
**Settings → Users & Access** (see **manage-users-and-access**) — there is
nothing special about how the key itself is assigned.

What *is* unusual, and worth knowing before answering "why can't Sanjana see
this Set": like Attendance, **own-only is the default, and it's gated on
assignment, not on the key**. Holding the `leads` view key only lets an
employee see **Sets currently assigned to them** (`lead_sets.current_assignee_id`)
— never a shared pool, never another staff member's Set. Manager/owner see
and manage every Set regardless of assignment, via the same
`is_manager_or_above()` added for Attendance (reused, not redefined).
`isCurrentHolderOrManager()` (`apps/erp/lib/leads.ts`) is the one place this
check lives, called by every route under `/api/lead-sets` and `/api/leads`.

So "give Sanjana the Leads module" is two different things, and both matter:

1. **Grant the page** — Settings → Users & Access → tick `leads` (and its
   "Can edit" box) for Sanjana's account, same as any other page.
2. **Assign her a Set** — granting the page alone shows her an empty list.
   She needs at least one Lead Set actually assigned to her
   (`current_assignee_id`), either because she uploaded/created it herself
   (auto-assigns to the creator) or because a manager/owner reassigned an
   existing Set to her from the Leads page.

**Reassigning a Set is manager-or-above; cloning it (a fresh copy with no
history) is owner-only.** This is one notch stricter than the plain
page-edit grant most other modules use for their day-to-day actions —
reassignment is the specific lever the owner asked for control over, since
it decides who can see a batch of contact data, not just who can edit a
record. See **leads** for the transfer-vs-clone distinction itself.
