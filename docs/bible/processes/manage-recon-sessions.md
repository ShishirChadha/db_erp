---
slug: manage-recon-sessions
title: Opening, closing, and reopening a reconciliation session
kind: process
audience: [owner]
module: reconciliation
routes: [/dashboard/recon/sessions]
keywords: [recon session, close session, reopen session, month end, reconciliation period, recurring expense watch, open count, bank recon session, mahine ka hisaab]
sources:
  - apps/erp/app/dashboard/recon/sessions/page.tsx
  - apps/erp/app/api/recon-sessions/route.ts
  - apps/erp/app/api/recon-sessions/[id]/summary/route.ts
  - apps/erp/app/api/recon-sessions/[id]/close/route.ts
  - apps/erp/app/api/recon-sessions/[id]/reopen/route.ts
  - apps/erp/lib/recon/session-summary.ts
updated: 2026-09-16
---

## What this is

A `recon_sessions` row is the unit of "keep going until nothing's left" for
bank reconciliation — one row per bank account + calendar-month period, tracked
open/matched counts, and a close that's only allowed once every transaction in
that period is matched or explicitly explained/ignored. Actually matching
individual transactions is covered in **reconcile-bank-transactions**; this
chapter is about the session container itself.

## Who can do this

Owner only — every route here checks `isOwner()`, and the page is wrapped in
`RequireOwner`.

## What a session groups

Everything in `bank_transactions` for one `bank_account_id` whose `txn_date`
falls within one calendar month (`period_start`/`period_end`, always the 1st
to the last day of the month picked). There's no way to scope a session to a
partial month or a custom date range from this page — the month picker drives
it directly.

## Steps — open a session

1. Open **Reconciliation → Recon Sessions** (`/dashboard/recon/sessions`).
2. Pick the bank account and the month.
3. The page opens (or resumes) a session for that exact account+period
   automatically — there's no separate "New Session" button. If a
   non-closed session already exists for that account+period, it's reused
   (its counts are refreshed, not duplicated); otherwise a fresh session is
   created with `status: 'in_progress'`.
4. The summary strip (total transactions, open count, total debits, total
   credits) and the list of still-open transactions load underneath. Counts
   are always recomputed live from `bank_transactions` on every load — never
   trusted from a stale cached value on the session row itself.

## The recurring-expense watch

If the account's entity (Digitalbluez/Techtenth/Cash) has any active
`recurring_expense_rules` entries, the session summary checks each rule's
expense type: if that type has real expense history in an *earlier* period but
no expense landed in the *current* period, it's flagged in a warning box —
"Recurring expenses expected but not seen this period," with the type and when
it was last seen. The idea is that a missing recurring cost (rent not paid
this month, an internet bill that never showed up) is easier to overlook than
an unexpected one. This reads from the same `recurring_expense_rules` table
that the separate daily `scan_recurring_expenses()` cron job uses (see
**expenses**) — it used to be a hardcoded `['Rent', 'Electricity', 'Internet']`
list until 2026-09-01, so there's now one definition of "what counts as
recurring," not two.

## Steps — close a session

5. Work through every open transaction (see **reconcile-bank-transactions**)
   until none are left.
6. Click **Close Session**. The button itself is disabled client-side while
   any transaction is still open, but the server re-checks the real open count
   fresh before honoring the close regardless — if a transaction was added or
   unmatched since the page last loaded, the close is refused with the current
   open count rather than trusting stale UI state.
7. Closing sets `status: 'closed'`, records `closed_by`/`closed_at`, and
   freezes the matched/total counts.

## Steps — reopen a closed session

8. Switch to that account/month again (a closed session still loads the same
   way) and click **Reopen**.
9. This is only allowed while the session is actually `closed`. It flips
   status back to `in_progress` and records `reopened_by`/`reopened_at`.
10. **Reopening is an audited action** — every reopen writes an audit-log
    entry regardless of anything else. The API route accepts an optional
    `reason` string to attach to that audit entry, but the Recon Sessions
    page's Reopen button doesn't currently prompt for one — it calls the route
    with an empty body, so in practice the logged reason is always blank
    through this UI even though the mechanism supports recording one.

## Common mix-ups

- **"Close Session is greyed out and I don't know why."** It's disabled the
  moment any transaction in the period is still `open`/`split` — scroll the
  session's transaction list; there's always at least one left to match,
  explain, or ignore.
- **"I closed the wrong month by mistake."** Reopen it — it's designed to be
  reversible, just always logged. There's no "undo close" distinct from
  reopen; reopening *is* the undo.
- **"The recurring-expense warning showed up but I did pay rent this month."**
  Check the expense was logged with the exact same `type` value the rule uses
  and dated inside this period — a rent expense typed as a slightly different
  category, or dated the last day of the *previous* month, won't be seen as
  "in period."

## Related

**reconcile-bank-transactions** (the actual matching that clears a session's
open count), **reconciliation** (module overview), **expenses** (the
recurring-expense rules table and its own scheduled reminder mechanism).
