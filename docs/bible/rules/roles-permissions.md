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
updated: 2026-10-03
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
