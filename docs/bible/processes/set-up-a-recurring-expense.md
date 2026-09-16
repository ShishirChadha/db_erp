---
slug: set-up-a-recurring-expense
title: Setting up a recurring expense rule
kind: process
audience: [owner]
module: expenses
routes: [/dashboard/expenses]
keywords: [recurring expense, rent, electricity, internet, schedule, next due date, reminder, reminder lead days, interval, weekly, monthly, yearly, scan_recurring_expenses, due soon, har mahine, recurring bill]
sources:
  - apps/erp/components/RecurringExpensesManager.tsx
  - apps/erp/app/api/recurring-expenses/route.ts
  - apps/erp/app/api/recurring-expenses/[id]/route.ts
updated: 2026-09-16
---

## What this is

Defining a schedule — rent, electricity, internet, or any other cost that
recurs on a fixed cadence — so the system reminds someone to log it as it
comes due, instead of relying on memory. A rule (`recurring_expense_rules`)
is **not** an expense itself; it only produces a reminder task. The actual
`expenses` row still has to be logged normally each time (see
**log-and-edit-an-expense**) once the bill is actually paid.

## Who can do this

Owner only. The **Recurring Expenses** button only renders for an owner
session on the Expenses page (`{isOwner && <RecurringExpensesManager />}`),
and every route behind it (`GET`/`POST /api/recurring-expenses`, `PATCH`/
`DELETE /api/recurring-expenses/[id]`) independently checks `isOwner()` as
well.

## Steps — create a rule

1. Open **Expenses** (`/dashboard/expenses`) and click **Recurring
   Expenses**.
2. Pick **Type** from the searchable expense-type dropdown (or type a new
   one to add it on the fly, same as the expense-entry form).
3. Pick **Entity** — Digitalbluez, Techtenth, or Cash — the account this
   recurring cost is expected to be paid from.
4. Pick **Interval** — weekly, monthly, or yearly.
5. Set **Next Due Date** (required) — the date the next occurrence is
   expected.
6. Set **Remind (days before)** — how many days ahead of the due date the
   reminder should fire (defaults to 3).
7. Optionally set **Expected Amount** and a free-text **Description**.
8. Click **Add Rule** (`POST /api/recurring-expenses`) — Type, Entity, and
   Next Due Date are all required before the button enables.

## How the reminder actually gets created

A daily `pg_cron` job (`scan-recurring-expenses`, 21:30 UTC / 03:00 IST)
calls `scan_recurring_expenses()`, which looks for active rules whose
`next_due_date` has entered their own `reminder_lead_days` window. The claim
on each matching rule is the `UPDATE ... RETURNING` itself — advancing
`next_due_date` by the rule's interval *is* the claim, so a concurrent second
run of the scan can't double-fire on the same rule (this mirrors the fix
already applied to the activity due-date scanner after it shipped with the
opposite, race-prone SELECT-then-UPDATE pattern).

For each rule it claims, the scan creates:
- one real **`activities`** row (`related_type: 'recurring_expense'`,
  `related_id` = the rule's id) — this is a task, not a real `expenses` row,
  because the actual expense doesn't exist until someone logs it;
- one `activity_assignees` row, defaulting to whoever the rule's
  `assignee_id` is (falls back to the rule's creator if never set
  explicitly — there's no assignee field in the `RecurringExpensesManager`
  form itself, so this is effectively always the creator in practice);
- one **in-app-only** `notifications` row — no email, matching the
  deliberate scope-cut on the due-soon/overdue activity reminders.

The task then shows up wherever `activities` normally surface (pending
tasks, notifications) — logging the actual expense once it's paid is a
separate, manual step through the normal Add Expense flow; nothing here
auto-creates the `expenses` row.

## Steps — pause, resume, or remove a rule

9. Click **Pause** on an active rule to stop it from being scanned
   (`is_active: false`) without losing its configuration — click **Resume**
   to reactivate it later. Pausing is the recommended way to retire a rule
   that's still occasionally relevant.
10. Click **Delete** to permanently remove a rule — the button asks for a
    plain `confirm()` browser dialog, not a reason field. There's no
    soft-delete/restore for recurring rules the way there is for expenses,
    customers, or vendors — deletion here is final. Prefer Pause for
    anything that might come back.

## How this differs from the old bank-recon "recurring expense watch"

Before 2026-09-01, `recon_sessions`' summary ran a *separate*, passive check
against a hardcoded `['Rent', 'Electricity', 'Internet']` list — only
visible when a bank reconciliation session happened to be open, and
completely disconnected from this rule table. That watch still exists
today (see **manage-recon-sessions**), but it now reads its type list from
these same `recurring_expense_rules` rows instead of the old hardcoded
array — one definition of "what counts as recurring," not two. The two
mechanisms remain functionally distinct, though:

| | This chapter (`scan_recurring_expenses`) | Recon-session watch |
|---|---|---|
| Trigger | Daily cron, independent of any UI | Only runs when a recon session for that account/month is opened |
| Produces | A real `activities` task + in-app notification | A warning box in the session summary |
| Scope | Any active rule, any time | Only rules whose entity matches the bank account being reconciled, only within the currently open period |

## Common mix-ups

- **"I created a rule but no task showed up yet."** The cron job only runs
  once daily (03:00 IST) and only fires once the due date has entered the
  rule's own `reminder_lead_days` window — a rule due in 20 days with a
  3-day lead won't produce anything for another ~17 days.
- **"I paid the bill but the rule doesn't know."** It isn't supposed to —
  the rule only creates a reminder task; logging the actual expense (Add
  Expense, same Type/Entity) is a separate manual step. The rule's own
  `next_due_date` advances automatically at scan time regardless of whether
  the expense was actually logged.
- **"The recon-session recurring warning didn't match what I expected."**
  That's the *other* mechanism (see the comparison table above) — it only
  looks at rules whose entity matches the specific bank account/month you
  have open in Recon Sessions, and it's a warning, not a task.

## Related

**log-and-edit-an-expense**, **expenses** (module overview),
**manage-recon-sessions**, **reconcile-bank-transactions**,
**activities-notifications**.
