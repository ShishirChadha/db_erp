---
slug: leads
title: Leads / Calling Lists
kind: module
audience: [owner, manager, employee]
routes: ['/dashboard/leads', '/dashboard/leads/[id]']
keywords: [lead, leads, calling list, lead set, cold calling, pitch, sales pitch, follow up, followup, remark, remarks, telecalling, referral, convert to customer, golden data, lead recycling]
sources:
  - apps/erp/app/api/lead-sets/**
  - apps/erp/app/api/leads/**
  - apps/erp/app/dashboard/leads/**
  - apps/erp/lib/leads.ts
  - apps/erp/components/BulkImportDialog.tsx
updated: 2026-10-06
---

## What this covers

Cold-contact sales-pitch data — name, usually phone, sometimes email/address and a
free-text identifier — organized into named batches ("**Lead Sets**", e.g. "Golden
Data", "Noida Data") that the owner hands to one staff member at a time to call and
pitch. Covers importing, assigning, following up, and converting a lead into a real
`customers` record once they buy.

## Why this isn't just a `customers` row

A `customers` row stands for one real-world party with (eventually) real transaction
history; a **lead** is a pre-sale, unconfirmed contact that may turn out to be a
duplicate, a wrong number, or genuinely not interested. The assignment/recycling model
this module needs — hand a whole batch to someone, later reassign it with or without
history — has no analog on `customers`, and folding leads into that table would also
mean retrofitting the Customers page's security model (see below). `leads`/`lead_sets`/
`lead_set_assignment_history` are a separate, additive set of tables.

## Why this isn't routed through `lib/auth/redact.ts`

That system hides specific *columns* by role (cost price, vendor, margin). What this
module actually needed is partitioning *rows* by who a Set is currently assigned to —
a different axis entirely. Forcing it through `redact.ts` would have meant adding a
sixth "shape" that doesn't match any of that system's column-hiding logic.

## A Lead Set is the unit of assignment, not the individual lead

Every `leads` row belongs to exactly one `lead_sets` row, and `lead_sets.current_assignee_id`
decides who can see and work the whole batch — **not** a per-lead assignee. Reassigning
a lead individually is deliberately not supported; every real example that shaped this
module was Set-level ("I gave Sanjana this set, she finished it, now give it to Akash").

## Access: own-Set-only by default, same shape as Attendance

`isCurrentHolderOrManager()` (`lib/leads.ts`) gates every route: manager-or-above sees
and can act on every Set; a plain employee only sees Sets where
`current_assignee_id` is their own id. This mirrors the row-partition RLS pattern
shipped for Attendance three days earlier (`backups/20261005_attendance_core.sql`) —
`public.is_manager_or_above()` is reused, not redefined. Both layers exist: the API
route check (the real boundary, since every route here runs on `supabaseAdmin`, which
bypasses RLS) and an RLS policy of the same shape as defense-in-depth, in case anything
ever queries these tables directly.

**This module deliberately does not repeat the Customers page's security gap.** The
Customers page queries Supabase directly from the browser, gated only by a blanket
`is_staff()` RLS policy — no row or field partitioning at all. Leads reads/writes go
through API routes instead, which is what makes "an employee only sees their own
assigned Set" actually enforceable.

## Two reassignment modes, and why they need different mechanics

- **Transfer** (`POST /api/lead-sets/[id]/reassign`, manager-or-above) — same `leads`
  rows, same Set. Updates `current_assignee_id`, closes/opens a
  `lead_set_assignment_history` row, and — this part is load-bearing —
  **swaps `activity_assignees` on every worked lead's linked activity** from the old
  holder to the new one. Skipping that swap would leave the old holder still able to
  see call-history comments in the Activity Hub after handoff, silently defeating the
  point of reassignment. History and remarks stay visible to the new holder; that's
  what "with history" means.
- **Clone** (`POST /api/lead-sets/[id]/clone`, owner-only) — a brand-new `lead_sets`
  row (`cloned_from_set_id` set) with only contact fields copied into new `leads`
  rows — status reset, `activity_id` null. No activity is copied, so the new Set has
  zero history by construction, not by any special hide-rule. The original Set, its
  leads, and all history stay fully intact and owner-visible. This is the "fresh copy
  for fresh calling" case.
- **From customers** (`POST /api/lead-sets/from-customers`, manager-or-above) — a
  one-time snapshot of selected `customers` rows into a new Set (e.g. a win-back
  campaign). Copies `customer_name`/`phone`/`email`/`address` only; never financial or
  sales history, and never sets `converted_customer_id` (these aren't conversions —
  `customers` is the source here, not the destination).

## Remarks and follow-up dates are the Activity Hub, not new columns

Each lead gets a linked `activities` row (`related_type: 'lead'`) **lazily**, created
on the first remark or follow-up date set against it — never at import time. Creating
one eagerly per lead on a 500-row CSV import would flood the Activity Hub and fire a
notification storm for contacts nobody has touched yet. A follow-up date is literally
`activities.due_date` on that same row, which means the existing, related-type-agnostic
`scan_activity_due_dates()` pg_cron job already raises due-soon/overdue notifications
for it — no new migration, no new cron job. The remark text itself is an
`activity_comments` row on the same activity, posted via the same mechanics
`/api/activities/[id]/comments` uses.

`GET /api/leads` enriches each row with `follow_up_date` and `last_note` by resolving
`activity_id → activities.due_date` / the newest `activity_comments` row, so the list
view and its filters don't require opening every lead individually.

## Filters

The Set-detail leads list supports a status filter (backed by the `lead_status`
`custom_options` category — New, Contacted, Follow-up Scheduled, Interested,
Converted, Not Interested, Dead) and a follow-up filter (overdue / due today /
upcoming / has-a-date / none), resolved server-side as a two-step query against
`activities` rather than a PostgREST embedded-resource filter. Both compose with a
free-text search across name/phone/email/identifier.

## Importing

`BulkImportDialog.tsx` is a sibling of `BulkAddDialog.tsx`, not a patch to it:
`BulkAddDialog` inserts straight from the browser via the client-side Supabase
instance, which only works for Customers because its RLS has no row partitioning —
Leads' RLS grants a plain employee no `INSERT` at all, by design, so a direct insert
would simply fail for anyone but a manager/owner. `BulkImportDialog` instead parses
the CSV client-side, **auto-detects column headers against an alias list** (handles
real-world header quirks — "Hone" for Phone, "Email Id" for Email — rather than an
exact-match lookup), always shows an editable mapping + preview before import, and
POSTs the mapped rows to `POST /api/lead-sets`.

Duplicate phone numbers across *different* Sets are expected and only ever **warn**,
never block — unlike `customers_active_phone_unique`, a lead is "this phone as it
appeared in this particular list," and the same person can legitimately show up in
both "Golden Data" and "Google Data".

Referrals (an existing lead mentions someone else worth pitching) go through a
single-lead **Add Lead** action inside a Set (`POST /api/leads`), not a CSV round-trip.

## Converting a lead

`POST /api/leads/[id]/convert-to-customer` reuses `checkDuplicateCustomer()` from
`lib/customer-dedupe.ts` — the exact same block-on-phone / warn-on-name rule the
Customers page itself uses — so a lead that turns out to already be a customer links
to the existing record instead of creating a duplicate.

## Who can do what

- **Upload a new Set / add a single lead / log a remark / set a follow-up date / edit
  a lead's fields / rename or delete a Set** — whoever currently holds that Set, or
  manager/owner. Self-serve, immediately real, no approval gate — same posture as
  every other operational entry point in this app.
- **Reassign a Set (transfer-with-history)** — manager or above.
- **Clone a Set (fresh copy) / create a Set from existing customers** — owner, and
  owner/manager respectively; cloning is the more consequential "start a fresh
  campaign" decision.
- Page access and edit grant are the ordinary `leads` key, set in
  **Settings → Users & Access** like any other page — see **manage-users-and-access**
  and **roles-permissions**.

## Not covered yet

CSV export/download (deliberately not built — reduces the risk of a departing
employee taking a list with them; the Customers page has no export either, so this
isn't a regression), per-lead reassignment independent of its Set, and a dedicated
stale-lead reminder cron beyond the generic due-date one `scan_activity_due_dates()`
already provides once a follow-up date is set.

## Related

**activities-notifications** (the lazily-created task per lead, its comments, and the
due-date reminder cron this module rides on with zero new code), **customers-vendors**
(conversion target, and the dedupe rule reused), **roles-permissions** (the `leads`
page key, and why Customers' RLS gap wasn't repeated here), **attendance** (the
own-Set-or-manager RLS shape this module copied), **settings-admin** /
**manage-users-and-access** (granting the page to a staff member).
