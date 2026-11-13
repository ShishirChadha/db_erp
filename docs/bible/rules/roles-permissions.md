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
  - apps/erp/app/api/users/route.ts
  - apps/erp/components/UserManager.tsx
  - apps/erp/app/api/sales/[id]/route.ts
  - apps/erp/app/api/sales-entry/route.ts
  - apps/erp/app/api/expenses/[id]/route.ts
  - apps/erp/app/api/customers/merge/route.ts
  - apps/erp/app/api/asset-ledger/[id]/reassign-sku/route.ts
  - apps/erp/app/api/stock-intake/[id]/route.ts
  - supabase/migrations/20261111_rls_lockdown.sql
updated: 2026-11-13
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
app's own writes run on `supabaseAdmin` (service role), which bypasses Postgres RLS.

RLS still matters, because a signed-in browser also holds the public database key
and can talk to the database directly, skipping the app. Since 2026-11-11 the core
money and workflow tables (sales, sale payments, invoices, purchase orders, repair
and replacement jobs, expenses, activities, notifications) can only be *read* by
staff from the browser; every change goes through an API route. Website customers
share the same sign-in system as staff, so every policy is written against an
*active staff profile* (`is_staff()`), never just "is signed in".

## Owner-only is about money leaving, not about seniority

Rentals is the clearest illustration of the line this app actually draws. Opening a
rental, handing units over, recording a return, raising the rent charge, a rent-to-own
buyout and closing the agreement all run on the ordinary `rentals` page-edit grant —
they are operational work, and operational work is never gated behind the owner.
Settling a **security deposit** is owner-only, because that is money going back out of
the business, the same line already drawn around correcting a sale payment.

Generating the GST invoice for a rental needs no new rule at all: it goes through the
existing owner-only sales finalize routes like every other invoice.

## What a non-owner can change, area by area

Four layers, from least to most access. A person gets everything in the layers
below the one that names them.

**1. No grant at all (every active employee).** Sees only Settings (Appearance,
My Navigation, Audit Log) and the DB Guide. Can: re-assign a unit to another SKU;
swap a unit's RAM/SSD (moves accessory stock; the cost amount is hidden); edit an
intake unit that is still in QC pending (SKU, serial, notes); add a value to a
dropdown list (not edit or delete one, and not activity tags); punch in/out, file
or cancel their own leave, mark their own notifications read; and work on tasks
they are assigned to or watching (edit, comment, tick checklist items).

**2. A view grant is already enough for some changes.** The page key alone allows:
- `new_entry` — Sell (creates sales and payments), register intake units, create
  repair / replacement / accessory-replacement jobs (each creates a sale), create
  SKUs (cost is dropped), stock receipts and adjustments, edit the vendor / price /
  GST on an accessory receipt, add an accessory vendor.
- `live_stock` or `stock` — submit QC (grade, warranty), send a unit back to QC,
  mark ready for sale.
- `live_stock`, `new_entry` or `sales` — record a payment on a sale (can be
  backdated, can use customer credit).
- `accessories` or `sku_master` — stock receipts and adjustments, edit a receipt's
  vendor and price.
- `customers` — merge two customers (rewrites the name on issued invoices).
- `leads` — for a lead set they hold: add / edit leads and notes, convert to a
  customer, upload new sets.
- `activities` — create and assign tasks. `marketing` — generate AI drafts, create
  and edit assets.

**3. A "Can edit" checkbox (Settings → Users).** Enforced for these only:

| Checkbox | What it adds |
|---|---|
| Live Stock, Stock | Edit a unit (including sold / invoiced ones, with a reason); edit a sale's price, customer, payment account and date — including an invoiced sale, and the GST period lock is not checked; bulk e-way bills |
| Sales | Edit a sale; bulk e-way bills |
| Repair Jobs | Edit status, payment, amount and GST; add parts; mark done |
| Replacement Jobs | Edit status and description (payment fields stay owner-only) |
| Rentals | Open, edit, add / return units, buyout, bill charges, close (deposit fields stay owner-only) |
| Returns / RMA | Customer-return cases only; vendor returns stay owner-only |
| Website | The nine web fields and publish toggle on a SKU, photos |
| Quotations | Create, edit, void, email to any address |
| Expenses | Create, edit, delete / restore, GST fields, reimbursements, receipt files (owner-only expense types stay hidden) |
| Marketing | Change an asset's status, delete assets, festivals |
| Attendance | With the manager role: team attendance, punches, leave decisions |

**Six checkboxes currently do nothing** — no server route or screen checks them:
New Entry, Accessories, SKU Master, Invoices, Customers and Activity Hub. Ticking
one changes nothing; layer 2 is what actually applies for those areas. There is no
checkbox at all for Dashboard, Pending Tasks, Reports or Leads.

**4. Never grantable (owner only).** All purchasing (orders, receiving, payments,
attaching units), generating / editing / emailing invoices, credit notes, voiding a
sale, correcting or deleting a payment, GST and filings, bank and reconciliation,
pricing, editing / deleting vendors, SKU edits beyond the web fields (and delete /
merge / categories), deleting a unit or adding cost adjustments, replacement-job
payments and finalizing, rental deposits, vendor RMAs, recurring expenses,
reimbursement removal, customer tier, users, settings, website admin and SEO,
backup and restore, audit restore, dropdown edit / delete, the staff roster.

**Manager role** adds, on top of an employee: submitting a purchase order, deleting /
assigning / reassigning / merging lead sets, and (with the Attendance checkbox)
team attendance and leave decisions. Nothing else.

**Database level.** Money and workflow tables are read-only from a browser (see
*Where the enforcement actually lives*). A smaller set of operational tables —
units, QC records, SKUs, customers, rental agreements, expenses, promotions — can
still be written by any active staff login at the database level, even though the
screens never use that path. This is a known tightening item, tracked by the owner.

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
- **Fixed 2026-10-23:** a failed *network* call while checking a session is no
  longer treated as "not signed in". When the key set or the `profiles` lookup is
  unreachable, `getSessionUser()` throws `SessionCheckUnavailable`, so the route
  answers 500/503 instead of 401. Even after a 401, `api-client.ts` signs out
  only once `/api/auth/session-check` confirms the session is really gone, and
  then only that browser (`signOut({ scope: 'local' })`). The Log out button is
  local too, so logging out of one device no longer ends the others.

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

So "give Sanjana the Leads module" is really two things now:

1. **Grant the page** — Settings → Users & Access → tick `leads` for
   Sanjana's account, same as any other page. There is no separate "Can edit"
   checkbox for Leads any more (see below) — this view-access tick is the
   whole grant.
2. **Assign her a Set** — granting the page alone shows her an empty list.
   She needs at least one Lead Set actually assigned to her
   (`current_assignee_id`), either because she uploaded/created it herself
   (auto-assigns to the creator), a manager/owner reassigned an existing Set
   to her, or a manager/owner forked her a working copy of a master Set.

**Leads is the one module (so far) with no edit grant at all (2026-10-27).**
Every per-lead and per-Set mutation route (`PATCH`/`POST /api/leads`,
`POST`/`PATCH /api/lead-sets`, notes, convert-to-customer) checks
`hasPageAccess(sessionUser, 'leads')` plus `isCurrentHolderOrManager()` — never
`canEditPage`. Holding a Set (being its `current_assignee_id`, or being
manager/owner) is what grants edit and add rights on it; `'leads'` was removed
from `EDITABLE_PAGE_KEYS` in `app/api/users/route.ts` /
`app/api/users/[id]/route.ts` / `UserManager.tsx` because the checkbox would
otherwise do nothing. This generalizes what started as a narrower 2026-10-13
carve-out (single-lead-add only, gated on view access alone, same shape as the
accessory-vendor-creation exception in **business-rules**: creating something
new is lower-stakes than editing what's already there) to the whole module —
the owner's own framing for it was "that user can edit/add but no delete".

**Delete is the one action pulled the other way.** `DELETE /api/leads/[id]`
and `DELETE /api/lead-sets/[id]` check `isManagerOrAbove(sessionUser)` alone,
with no holder exception — an employee holding a Set can edit/add on it
freely, but can never delete from it.

**Reassigning an in-progress working copy (transfer-with-history), assigning
a new working copy from a master, and merging a working copy's changes back
are all manager-or-above; cloning a Set (a fresh, permanently disconnected
copy) is owner-only.** This is one notch stricter than the "holding the Set is
enough" rule above — deciding who gets a copy of a batch of contact data, and
what gets folded back into the original, is the specific lever the owner
asked for control over. See **leads** for the master/working-copy model and
the assign-vs-reassign-vs-clone distinctions.
