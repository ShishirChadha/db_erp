---
slug: leads
title: Leads / Calling Lists
kind: module
audience: [owner, manager, employee]
routes: ['/dashboard/leads', '/dashboard/leads/[id]']
keywords: [lead, leads, calling list, lead set, cold calling, pitch, sales pitch, follow up, followup, remark, remarks, telecalling, referral, convert to customer, golden data, lead recycling, master set, working copy, merge, dedupe, duplicate]
sources:
  - apps/erp/app/api/lead-sets/**
  - apps/erp/app/api/leads/**
  - apps/erp/app/dashboard/leads/**
  - apps/erp/lib/leads.ts
  - apps/erp/components/BulkImportDialog.tsx
updated: 2026-10-27
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

## Master Sets vs. working copies (2026-10-27)

The owner wanted the opposite of "handing over the only copy": the original/raw data a
Set was created from should stay owner-controlled forever, while each employee works a
disposable copy whose edits and new referrals can later be reviewed and folded back in.

A `lead_sets` row is a **master** by default — every CSV import, `from-customers`
snapshot, and existing fresh-copy Clone stays exactly as before, unaffected by this. It
becomes a **working copy** only when forked via `POST /api/lead-sets/[id]/assign`
(manager-or-above), which sets `working_copy_of_set_id` to point at the master. The
master itself is never touched by this — every one of its current, non-deleted leads is
simply copied into new `leads` rows in the working copy, each carrying:

- `source_lead_id` — which master lead it was forked from. `NULL` means the row was added
  directly inside the working copy (a referral), not forked from anything.
- `source_snapshot` — the contact fields as they stood at fork time, so a later merge
  diff only surfaces fields the employee actually touched.
- `merge_status` — `'pending'` until reviewed; `'merged'` or `'skipped'` after a merge
  decision. Every pre-existing `leads` row (anything older than this feature) defaults to
  `'merged'`, since there's nothing to review on data that predates it.

This is deliberately a *different* self-FK from `cloned_from_set_id`: Clone's own
contract ("fresh copy, never merges back", owner-only, for a brand-new campaign) does not
change — it keeps its own column and meaning. `working_copy_of_set_id` is the new,
always-mergeable relationship, and nothing stops the same master being forked to more
than one employee in parallel (no uniqueness constraint); the owner decides whether
that's ever actually used.

## Merging a working copy back into its master

`GET /api/lead-sets/[id]/merge-preview` (id = a working copy, manager-or-above) computes
a review-only diff over every lead still `merge_status='pending'` — it writes nothing.
For a lead with `source_lead_id`, it's only surfaced if the working copy's current
contact fields differ from `source_snapshot` (the employee actually touched it); it's
compared three-way against the master lead's *current* live values too, since another
working copy may already have merged a different change into the same master lead since
this one was forked — that case is flagged as a conflict rather than silently decided.
For a lead with no `source_lead_id` (a referral), it runs a broadened duplicate check —
`findLeadMatches()` (`lib/leads.ts`, extends `findDuplicatePhones()` to also check email
and name) — against the entire `leads` table and returns candidate matches.

`POST /api/lead-sets/[id]/merge-commit` takes the owner's per-lead decisions and applies
them — this module never auto-merges silently. An edited existing lead's fields get
written onto its master row. A referral with no duplicate is inserted into the **same
master** it was forked from (not a separate pool). A referral matched to a duplicate is
folded in the same way `customers/merge` folds a duplicate customer: the existing record
is kept, and only its currently-blank fields are filled in from the referral — never
overwritten where the kept record already has a value.

## Edit/add rights now follow holding a Set, not a separate grant (2026-10-27)

Per the owner's own framing — "that user can edit/add but no delete" — every per-lead and
per-Set mutation route in this module (`PATCH`/`POST /api/leads`, `POST`/`PATCH
/api/lead-sets`, notes, convert-to-customer) now checks `hasPageAccess(sessionUser,
'leads')` plus `isCurrentHolderOrManager()` — **not** `canEditPage`. Holding a Set (being
its `current_assignee_id`, or being manager/owner) is what grants edit and add on it now;
the separate Leads edit grant does nothing any more and was removed from Settings → Users
& Access (`EDITABLE_PAGE_KEYS` in `app/api/users/route.ts` /
`app/api/users/[id]/route.ts` / `UserManager.tsx`). This is a deliberate generalization of
the narrower 2026-10-13 carve-out that first did this for single-lead-add only — see
**roles-permissions** for the full reasoning.

Delete is the one exception pulled the *other* way: `DELETE /api/leads/[id]` and
`DELETE /api/lead-sets/[id]` now check `isManagerOrAbove(sessionUser)` alone, with no
holder exception at all. An employee holding a Set can edit and add freely on it, but can
never delete from it, regardless of any grant.

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

- **Upload a new Set / add a lead / edit a lead's fields / log a remark / set a
  follow-up date / convert to customer / rename a Set** — needs only **view**
  access to the `leads` page (`hasPageAccess`), as long as the Set is currently
  assigned to that person (or they're manager/owner). There is no separate edit
  grant to this module any more (see above) — holding a Set is what grants
  edit/add on it.
- **Delete a lead or a Set** — manager or above, full stop. Never unlocked by
  holding the Set, and never affected by any grant.
- **Assign a working copy of a master Set to someone** — manager or above.
- **Reassign an in-progress working copy (transfer-with-history) to a different
  holder** — manager or above. Unchanged from before: this still moves the same
  rows, keeping the outgoing holder's edits/history intact for the new holder.
- **Merge a working copy's changes back into its master** — manager or above,
  review-then-commit (never silent).
- **Clone a Set (fresh, permanently disconnected copy) / create a Set from
  existing customers** — owner, and owner/manager respectively; cloning is the
  more consequential "start a fresh campaign" decision, and deliberately
  distinct from "assign a working copy" above.
- Page access is the ordinary `leads` key, set in **Settings → Users & Access**
  like any other page — see **manage-users-and-access** and
  **roles-permissions**. There is no "Can edit" checkbox for Leads any more;
  view access plus being a Set's current holder is the whole story for
  edit/add, and delete/assign/reassign/merge/clone are role-gated on top.

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
