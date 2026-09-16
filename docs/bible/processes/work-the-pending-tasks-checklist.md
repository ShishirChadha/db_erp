---
slug: work-the-pending-tasks-checklist
title: Working the Pending Tasks checklist
kind: process
audience: [owner, manager, employee]
module: activities-notifications
routes: [/dashboard/pending-tasks]
keywords: [pending tasks, checklist, what needs attention, derived checklist, qc pending, needs po, needs invoice, payment pending, rma open, daily checklist, aaj kya karna hai]
sources:
  - apps/erp/app/dashboard/pending-tasks/page.tsx
updated: 2026-09-16
---

## What this is

**Pending Tasks** (`/dashboard/pending-tasks`) is a cross-cutting "check
this first thing" dashboard, not a real task list. Every row on it is
**computed live** from other tables at page-load time — nothing here is
its own stored record, and nothing here is part of the `activities` system
covered in **create-and-manage-a-task**. It exists purely to surface what's
outstanding across Repair Jobs, RMA, Live Stock, and Sales in one place,
each row deep-linking into the page that actually owns that record.

This is a deliberate, documented architectural difference (see
`CLAUDE.md`): the operational checklist here stays derived and is never
promoted into a stored `activities` row.

## Who can do this

Any signed-in staff member with the `pending_tasks` page key can open the
page, but what they see differs sharply by role.

## What you see

- **Every role** sees:
  - **Repair Jobs In Progress** — repair jobs with `status` in `intake` or
    `in_progress` (from `GET /api/repair-jobs`).
  - **QC Pending Stock** — units from `GET /api/stock?status=qc_pending`.
- **Owner only** additionally sees:
  - **RMA In Progress** — RMA events not yet `closed`.
  - **Payment Pending** — sales where `payment_status !== 'paid'`.
  - **Needs PO Attached** — stock-intake rows (`GET /api/stock-intake`)
    still missing a purchase order.
  - **Accessory Stock Needs PO** — accessory receipts
    (`GET /api/purchase-orders/from-accessory-stock`) with quantity
    received but no vendor/PO attached yet.
  - **Needs Invoice** — sales entries (`GET /api/sales-entry`) not yet
    turned into a formal invoice.

Each section only renders when it has at least one row and is capped to
showing the first 8, with a **View all** link to the page that actually
owns the data (Repair Jobs, Live Stock, RMA, Sales, Accessories). If
nothing is outstanding anywhere, the page just says "Nothing pending --
you're all caught up."

## Why you can't edit, assign, or dismiss a row here

Because nothing on this page is a real record of its own — there is no
`pending_tasks` table, no status field to change, and no assignment model.
"Resolving" an item here always means going and doing the underlying
action on its owning page (e.g. QC-ing the unit on Live Stock, attaching a
PO on the PO page, recording a payment on Sales) — once that underlying
condition is no longer true, the row simply stops appearing here on next
load. There is nothing to click "done" on directly from this page.

## Common mix-ups

- **"I marked this done but it's still showing."** — you can't mark
  anything done from this page itself; the row disappears only once the
  underlying condition changes (e.g. the PO is actually attached, the
  payment is actually recorded) on the page that owns it.
- **"Why does an employee see fewer sections than the owner?"** — by
  design: the owner-only sections here (RMA, Payment Pending, Needs PO,
  Needs Invoice) surface cost/bookkeeping-adjacent gaps, matching the same
  owner-only boundary those underlying pages already enforce.
- **"Can I assign one of these to a coworker?"** — not from here. If it
  genuinely needs to be tracked as an assigned piece of work, create a
  real task in the Activity Hub instead (see
  **create-and-manage-a-task**), optionally linking it to the same
  business record.
