---
slug: expenses
title: Expenses
kind: module
audience: [owner, manager, employee]
routes: [/dashboard/expenses]
keywords: [expense, electricity, rent, transport, food, porter, freight, shipping, receipt, attachment, recurring expense, expense type, vendor, staff reimbursement, paid by staff, out of pocket, dues, settle, owner only, salary, salaries, bank charges, gst payment, sensitive]
sources:
  - apps/erp/app/api/expenses/**
  - apps/erp/app/api/recurring-expenses/**
  - apps/erp/app/api/custom-options/**
  - apps/erp/components/AddExpenseDialog.tsx
  - apps/erp/components/EditExpenseDialog.tsx
  - apps/erp/components/ExpenseAttachmentsField.tsx
  - apps/erp/components/RecurringExpensesManager.tsx
  - apps/erp/components/StaffReimbursementsManager.tsx
  - apps/erp/components/AddVendorDialog.tsx
  - apps/erp/components/DropdownOptionsManager.tsx
  - apps/erp/lib/expense-type-rules.ts
  - apps/erp/lib/owner-only-expense-types.ts
  - apps/erp/app/dashboard/expenses/page.tsx
updated: 2026-09-02
---

## What this covers

The general-purpose ledger for any cost that isn't a purchase (inventory) or a
sale — electricity, rent, transport, food, porter/freight, shipping, bank
charges, salaries, and anything else. Any role granted the `expenses` page
key can log/edit/soft-delete an expense; the category list
(`custom_options` category `expense_types`) is fully open-ended — anyone with
edit access can add a new type inline, no owner approval needed, same
"immediately real" posture as the rest of this app. **Except** the handful of
types the owner has marked owner-only (see below) — those are never offered
to, or visible to, a non-owner at all.

## Owner-only types

Some `expense_types` values are sensitive enough that no non-owner role
should see them at all — not just be unable to pick them, but not know a
matching row even exists. `custom_options` gained a generic `owner_only`
boolean (2026-09-01, Settings → Dropdown Options → "Make owner only" — a
cross-category capability, not expense-specific, though `expense_types` is
its first real use). Seeded `true` on `Salaries`, `Bank Charges`, `GST
Payment`; the owner can mark/unmark any other value the same way.

This is enforced at every layer, not just the dropdown:
- `GET /api/custom-options` never returns an `owner_only` row to a non-owner
  — the type simply isn't offered in the Type selector or the list page's
  Type filter.
- `GET /api/expenses` drops the **entire row** (amount, description,
  everything) for a non-owner when its `type` matches an owner-only value —
  `type` is free text, so a matching row can exist regardless of how it was
  entered, and hiding only the dropdown option wouldn't hide data already on
  disk. `POST`/`PATCH /api/expenses[/[id]]` reject a non-owner trying to
  set/change `type` to an owner-only value (403), and `PATCH` 404s a
  non-owner attempting to touch an existing row whose *current* type is
  owner-only (they couldn't have legitimately reached it via the list, which
  already excludes it).
- The reporting layer excludes owner-only-type rows from non-owner-visible
  aggregates too (see Reporting below) — otherwise a total or a type
  breakdown would leak what the hidden rows themselves don't.
- `lib/owner-only-expense-types.ts` (`getOwnerOnlyExpenseTypes()`/
  `isOwnerOnlyType()`) is the one shared helper behind all of the above —
  matching is case-insensitive, trimmed.

## Data model

`expenses`: `expense_date`, `description` (the sole free-text field the UI
collects — see below), `type` (free text, drawn from
`custom_options.expense_types` — not a separate `category` column),
`from_location`/`to_location` (shipping/porter-shaped expenses only, see
below), `amount`, `remarks` (a second free-text column still in the schema
but no longer collected by `AddExpenseDialog`/`EditExpenseDialog` as of
2026-09-01 — `description` absorbed it, one field instead of two confusingly
similar ones; historical `remarks` values and `GET /api/expenses`'s search
match on it are untouched), soft-delete triad, `payment_account`/`entity_key`
(same `Digitalbluez`/`Techtenth`/`Cash` vocabulary as `sales`/
`purchase_orders`), `vendor_id` (optional FK to `vendors`), `created_by`,
`source` (`manual` | `bank_recon`), `attachments` (jsonb array of
`{key, name, size}`, receipt files in the private `expense-receipts` Storage
bucket), `paid_by_staff`/`reimbursed_amount`/`reimbursement_status` (see
Staff reimbursements below).

**Which optional fields the entry form shows depends on `type` and
`paid_by_staff`** (`lib/expense-type-rules.ts`, both dialogs), not a fixed
layout:
- **From/To** only appear for a shipping/porter-shaped `type` (keyword match
  on "porter"/"freight"/"shipping" — deliberately excludes the broader
  "Transport" type, which doesn't necessarily have a from/to the way a
  shipment does).
- **Vendor** is hidden for the handful of types that clearly never have one
  (`salaries`, `bank charges`, `gst payment`) and shown by default for
  everything else, including any new custom type an owner adds later — an
  opt-out list, not an opt-in one, so a future type is never silently
  starved of a field it might need.
- **Paid From** (`payment_account`) is hidden entirely once `paid_by_staff`
  is set — see Staff reimbursements below for why.

**Vendor identity on an expense is owner-only in the UI** on top of the
type-based visibility above (the vendor picker and the list page's Vendor
column only render for `isOwner` sessions), matching this app's default
vendor-identity posture everywhere except the one narrow, deliberate
accessory-receipt exception (see **business-rules**) — expenses aren't that
exception. `GET /api/expenses` strips the joined vendor name server-side for
non-owner callers too, not just in the UI. As of 2026-09-01 the owner can
also add a brand-new vendor inline from either dialog (`AddVendorDialog.tsx`,
the same component Receive Stock/Accessories already reuse) instead of only
picking from the existing list. Receipts/attachments are **not** owner-gated
— any role with the `expenses` edit grant can attach/view one.

**Two independent write paths create `expenses` rows** and must be kept in
sync on any future schema change: `POST /api/expenses` (the normal form), and
`apps/erp/app/api/bank-transactions/[id]/match/route.ts`'s inline insert when
an owner matches an unmatched bank debit as `match_type='expense'`
(`source='bank_recon'`) — see **reconciliation**.

## Attachments

Receipt/attachment upload follows the `activity_comments.attachments` jsonb
precedent, not the Reconciliation `uploaded_documents` AI-extraction pipeline
(irrelevant baggage for a plain receipt photo). Upload is the standard
two-step signed-URL flow (`POST /api/storage/upload-url` → `PUT` → the
resulting `{key,name,size}` is included in the expense's own create/update
body), bucket `expense-receipts` (private, no `storage.objects` RLS policy —
gated entirely at the API layer, same posture as the `documents` bucket).
Removing an attachment from an existing expense also calls
`DELETE /api/storage/delete` for that key.

## Staff reimbursements

Sometimes a staff member pays an expense out of pocket (a courier fee, a
quick supply run) and the owner clears their dues at month-end. Setting
`paid_by_staff` on an expense (drawn from `custom_options.staff_names`, the
exact same category `sales.sold_by` uses, so staff without their own login
account can still be credited — same rationale) marks it reimbursable.
`expense_reimbursements` is an append-only ledger — **not an editable
field** — mirroring `sale_payments`/`vendor_payments` exactly, per the
existing "Sale payments are an append-only ledger" business rule.
`expenses.reimbursed_amount`/`reimbursement_status` (`not_applicable` |
`pending` | `partial` | `reimbursed`) are trigger-derived
(`sync_expense_reimbursement_totals`) from the sum of ledger rows; a second
trigger (`sync_expense_reimbursement_status_on_paid_by_change`, fires on
both INSERT and UPDATE) keeps the status correct when `paid_by_staff` itself
is set/cleared with zero reimbursement rows yet — **never write
`reimbursed_amount`/`reimbursement_status` directly from application code.**

`POST /api/expenses/[id]/reimbursements` is open to any role with the
`expenses` edit grant (any role can log that money changed hands, same
"immediately real" principle as a sale-payment installment) — in practice
the owner is usually the one clearing dues. `DELETE .../[reimbursementId]`
(correcting a mis-entered installment) is owner-only, matching
`sale_payments`'s own correction posture. The Expenses page's "Staff
Reimbursements" button (`StaffReimbursementsManager.tsx`) lists every
expense with an outstanding balance, grouped/filterable by staff, with a
checkbox-driven "Settle Selected" bulk action for the month-end clearing
workflow — one reimbursement row is recorded per selected expense line, not
a single lump-sum row spanning several expenses, so each expense's own
ledger stays independently correct.

**Why "Paid From" disappears once `paid_by_staff` is set** (2026-09-01): a
company account (`Digitalbluez`/`Techtenth`/`Cash`) is only meaningfully
known once the reimbursement actually happens — asking for it at entry time,
before anyone has decided which account will settle it, was confusing (the
whole point of a staff-paid expense is that *no* company account moved money
yet). So `expenses.payment_account`/`entity_key` stay `null` at creation for
a staff-paid expense. `StaffReimbursementsManager`'s "Reimbursed From"
selector captures the real account at settlement time instead — and
`POST /api/expenses/[id]/reimbursements` propagates the **first**
reimbursement's `payment_account` back onto the parent expense (only if it's
still `null` there; never overwrites an explicit value), so the expense
doesn't stay unattributed to either entity in reporting/recon forever once
it's actually been settled.

## Recurring expenses

`recurring_expense_rules` (owner-only to manage, via the "Recurring
Expenses" button on the Expenses page) defines a schedule — `type`,
`payment_account`/`entity_key`, optional `vendor_id`/`expected_amount`,
`interval_unit` (`weekly`/`monthly`/`yearly`), `next_due_date`,
`reminder_lead_days`, `assignee_id` (defaults to the creator). A daily
`pg_cron` job (`scan-recurring-expenses`, 21:30 UTC / 03:00 IST — date-
granularity reminders don't need the 15-minute cadence the task-due-time
scanner uses) calls `scan_recurring_expenses()`, modeled directly on
`scan_activity_due_dates()`: the claim is the `UPDATE ... RETURNING` itself
(advancing `next_due_date` by the interval *is* the claim — a concurrent
second run's `WHERE next_due_date <= current_date + reminder_lead_days`
simply won't match once the first commits), not a separate SELECT-then-UPDATE,
which is exactly the race `scan_activity_due_dates()` had to fix after
shipping (`fix_scan_activity_due_dates_race_condition`). Each claimed rule
gets one `activities` row (`related_type='recurring_expense'`,
`related_id` = the rule id — not a real `expenses` row, which doesn't exist
until someone actually logs it), one `activity_assignees` row, and one
in-app-only `notifications` row (no email, matching the due-soon/overdue
scanner's own deliberate scope cut).

This **replaces** the old passive mechanism: `recon_sessions`' summary used
to run an ad hoc "recurring-expense watch" against a hardcoded
`['Rent', 'Electricity', 'Internet']` array, only visible when a bank recon
session happened to run. That watch still exists (a type with history in an
earlier period but nothing in the current one gets flagged), but as of
2026-09-01 it reads its type list from `recurring_expense_rules` instead —
one definition of "what counts as recurring," not two. See
**reconciliation**.

## Reporting

`/dashboard/reports` → Expenses tab, added 2026-09-01, purely additive to the
existing reporting layer (see **finance-gst-reports**): `report_expenses`
(total/count/average for a period), `report_expense_timeseries` (daily
trend), and two new `report_breakdown` dimensions — `expense_type` and
`expense_vendor` (owner-only, matching the `vendor` dimension's existing
purchasing-spend posture). All read from a new `v_report_expense_lines`
view. **Not included**: a combined revenue-minus-expenses P&L figure inside
`report_kpis` — a bigger, riskier change to a heavily-relied-on function with
its own "costed units" margin semantics, deliberately left as a follow-up.

All three (`report_expenses`, `report_expense_timeseries`, and the
`expense_type` breakdown) take `p_include_financials` and exclude any
owner-only type's rows entirely when it's `false` — otherwise a non-owner
could still read off e.g. total salary spend from an aggregate even though
the individual rows are hidden from the Expenses list itself (see
Owner-only types below).

## Related

**reconciliation** (the bank-recon expense-creation path and the recurring-
expense watch this module now also drives), **finance-gst-reports** (the
reporting dispatcher this module's new metrics plug into), **business-rules**
(the default vendor-identity redaction posture), **activities-notifications**
(the task type `scan_recurring_expenses()` creates).
