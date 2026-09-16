---
slug: settle-staff-reimbursements
title: Settling staff reimbursements
kind: process
audience: [owner, manager, employee]
module: expenses
routes: [/dashboard/expenses]
keywords: [staff reimbursement, paid by staff, out of pocket, settle selected, reimbursed from, dues, owed, month end, staff dues, paisa wapas, reimbursement status]
sources:
  - apps/erp/components/StaffReimbursementsManager.tsx
  - apps/erp/app/api/expenses/[id]/reimbursements/route.ts
  - apps/erp/app/api/expenses/[id]/reimbursements/[reimbursementId]/route.ts
updated: 2026-09-16
---

## What this is

Clearing what the business owes a staff member who paid an expense out of
pocket — a courier fee, a quick supply run — logged earlier with **Paid By
Staff** set on the expense (see **log-and-edit-an-expense**). Every payment
recorded here is a new row in the append-only `expense_reimbursements`
ledger; `expenses.reimbursed_amount`/`reimbursement_status` are
trigger-derived from that ledger and are never written directly.

## Who can do this

Any role with the `expenses` page edit grant can open this dialog and settle
dues — `POST /api/expenses/[id]/reimbursements` checks `canEditPage(session,
"expenses")`, not `isOwner`, matching the same "immediately real" posture as
recording a sale-payment installment. In practice the owner usually does the
month-end clearing, but nothing in the code restricts it to them. **Deleting
or correcting** a mis-entered installment (`DELETE
.../reimbursements/[reimbursementId]`) *is* owner-only.

## Why "Reimbursed From" doesn't appear until now

At expense-entry time, a staff-paid expense has no company account attached
yet — that's the whole point of `paid_by_staff`: no Digitalbluez/Techtenth/
Cash money has moved. Which account actually pays the staff member back is
only meaningfully known once you're actually clearing the debt, so it's
captured here, at settlement, via the **Reimbursed From** selector — not on
the original expense form.

## Steps

1. Open **Expenses** (`/dashboard/expenses`) and click **Staff
   Reimbursements**.
2. The dialog loads every expense with `paid_by_staff` set and a
   `reimbursement_status` of `pending` or `partial` (fully-settled and
   not-staff-paid expenses never appear here). Each row's **Outstanding**
   column pre-fills with `amount − reimbursed_amount` — the exact remaining
   balance, editable per-row before you settle.
3. Optionally filter by **Staff** — the dropdown lists each staff name with
   their total amount owed across all their outstanding expenses.
4. Optionally set **Reimbursed From** (Digitalbluez / Techtenth / Cash) —
   this is the account that's actually paying the staff member back for
   every row you settle in this batch.
5. Tick the checkbox on each expense line you're paying out now (or use the
   header checkbox to select every currently-visible row), adjusting the
   **Outstanding** amount per row if you're only partially settling one.
6. Click **Settle Selected (N)**. This fires one `POST
   /api/expenses/[id]/reimbursements` call *per selected expense line* — not
   one lump-sum row spanning several expenses — so each expense's own ledger
   stays independently correct and traceable. Rows with a zero or blank
   amount are skipped.
7. After settling, the list refreshes: a fully-paid row drops off (status
   becomes `reimbursed`), a partially-paid row stays with a smaller
   Outstanding balance and `reimbursement_status: 'partial'`.

## Correcting a mistaken entry

Only the owner can delete a wrongly-recorded reimbursement installment
(`DELETE /api/expenses/[id]/reimbursements/[reimbursementId]`) — the
underlying trigger recomputes `reimbursed_amount`/`reimbursement_status`
automatically once the row is removed. There's no edit-in-place; a wrong
amount is corrected by deleting the bad installment and recording a new,
correct one.

## Common mix-ups

- **"I settled an expense but the Paid From on the expense itself is still
  blank."** The **first** reimbursement recorded against an expense
  propagates its `payment_account` back onto the parent expense — but only
  if the expense doesn't already have one set; it never overwrites an
  explicit value. If the expense still shows no account after settling,
  check whether an earlier reimbursement (possibly deleted since) already
  set — or failed to set — one.
- **"An expense I know is staff-paid isn't showing up in this dialog."**
  Check its `reimbursement_status` — only `pending` and `partial` rows are
  listed; if it already shows `reimbursed`, it's fully settled and correctly
  excluded, and if `paid_by_staff` was cleared on it, it's no longer
  reimbursable at all.
- **"Can an employee settle their own dues without the owner?"** Yes,
  by design — any role with the `expenses` edit grant can record a
  reimbursement installment, not just the owner; only *deleting* a wrong
  entry is locked to the owner.

## Related

**log-and-edit-an-expense**, **expenses** (module overview),
**record-a-part-payment** (the sale-side equivalent this mirrors),
**business-rules**.
