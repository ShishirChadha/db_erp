---
slug: reconcile-bank-transactions
title: Reconciling bank transactions
kind: process
audience: [owner]
module: reconciliation
routes: [/dashboard/recon/bank, /dashboard/recon/sessions]
keywords: [bank recon, bank statement, csv import, column mapping, match transaction, split match, transfer pair, inter-entity transfer, explain, ignore, expense from bank, dedup, continuity check, bank milan, statement upload]
sources:
  - apps/erp/app/dashboard/recon/bank/page.tsx
  - apps/erp/app/dashboard/recon/sessions/page.tsx
  - apps/erp/app/api/bank-statements/route.ts
  - apps/erp/app/api/bank-transactions/route.ts
  - apps/erp/app/api/bank-transactions/[id]/match/route.ts
  - apps/erp/app/api/bank-transactions/[id]/match/[matchId]/route.ts
  - apps/erp/app/api/bank-transactions/[id]/explain/route.ts
  - apps/erp/app/api/bank-transactions/[id]/raise-po-task/route.ts
  - apps/erp/app/api/bank-accounts/[id]/column-profile/route.ts
  - apps/erp/lib/recon/bank-import.ts
updated: 2026-09-16
---

## What this is

Importing a bank account's CSV statement and matching every line against
something real in the ERP — a customer's sale payment, a vendor's PO payment,
an existing stock-receipt, an inter-entity transfer between Digitalbluez and
Techtenth, or (when it's genuinely nothing else) a new expense. **Import and
column mapping happen on the Bank Reconciliation page; matching a transaction
actually happens on the Recon Sessions page** — the Bank Reconciliation page's
own transaction list is read-only and says so directly ("matching/explaining
transactions happens on Recon Sessions"). See **manage-recon-sessions** for
what a session itself is; this chapter covers the mechanics of import and of
each match type.

## Who can do this

Owner only — every route here checks `isOwner()`, and both pages are wrapped
in `RequireOwner`.

## Steps — import a statement

1. Open **Reconciliation → Bank Recon** (`/dashboard/recon/bank`).
2. Pick (or first add) a bank account — label, bank name, last-4 digits, and
   which entity it belongs to (Digitalbluez / Techtenth / Cash).
3. Choose the statement CSV. The importer scans the first 60 rows for the one
   that actually looks like a transaction-table header (several non-empty
   cells, at least two recognizable column-name words like "date"/
   "narration"/"debit") rather than assuming row 1 is the header — real
   exports (ICICI's "Detailed Statement" included) print an account-name/
   address/period preamble before the real table starts, and naively treating
   that as the header row used to silently lose every transaction. Along the
   way it also looks for "Opening Bal:"/"Closing Bal:" label rows in the file
   and pre-fills those two fields for you.
4. If this account already has a saved column-mapping profile
   (`bank_column_profiles`), it's applied automatically and the "save this
   mapping" checkbox is unticked (nothing new to save). Otherwise, map each
   target field (Date, Narration, Reference, Debit/Credit *or* a single signed
   Amount column, Running Balance) to one of the CSV's actual headers, and
   pick the date format (DD/MM/YYYY or ISO).
5. Set the statement's period start/end and opening/closing balance (often
   already pre-filled from step 3), review the 5-row preview, and click
   **Import**. Leave "Save this mapping for future statements from this
   account" checked the first time — every later statement from the same
   account then reuses it without remapping.
6. On import, the server (never the browser) computes a dedup hash from each
   row's own date/amount/narration/running-balance and only inserts rows whose
   hash isn't already present for this account — so re-downloading an
   overlapping range ("this month plus a few days of last month," which is
   normal behavior for most bank export tools) never duplicates rows. It also
   runs a two-part continuity check: opening balance + net(credits − debits)
   must equal closing balance, **and**, wherever the export prints a running
   balance, each row's balance must follow from the previous one — this
   second check is what catches a single dropped mid-statement row even when
   the totals happen to still net out. You're shown the inserted/duplicate
   counts and the continuity status (`ok`/`gap`/`mismatch`) in an alert after
   import.

## Steps — match a transaction (on Recon Sessions)

Open **Reconciliation → Recon Sessions**, pick the account and month, and work
through the transactions the session lists as open. See
**manage-recon-sessions** for how the session itself is opened/closed; the
match actions below are what actually clear each line.

7. **A normal credit match** (customer payment): the row lists suggested
   `sale_payments` candidates (amount, customer name, days away). Tick one and
   click **Match Selected**.
8. **A split match**: tick *more than one* candidate before clicking **Match
   Selected** — a single credit (one NEFT covering two separate invoices, say)
   settles several `sale_payments` rows at once. The dialog runs one match
   call per ticked candidate; the transaction's `recon_status` becomes `split`
   until the full credited amount is accounted for, then `matched`.
9. **A debit against a known purchase**: the row lists candidate stock
   receipts (`stock_movements`, the no-PO accessory-purchase case) or
   outstanding POs. Clicking **Match** on a PO candidate doesn't just link —
   it calls the same `POST /api/purchase-orders/[id]/payments` route as
   **record-a-vendor-payment**, so a debit matched this way *is* a new
   `vendor_payments` installment, auto-noted "Auto-recorded from bank recon:
   …". Matching a stock-receipt candidate is a pure link — it never touches
   inventory.
10. **A transfer-pair match**: for a debit/credit that's really the business
    moving its own money between its two entities' accounts — e.g. Techtenth's
    account shows a ₹50,000 debit narrated "transfer to Digitalbluez," and
    Digitalbluez's account shows a ₹50,000 credit the same week. Click
    **Transfer** on either leg; you're prompted (via a browser prompt) which
    other bank account holds the counterpart, and the system searches that
    account's still-open transactions for an opposite-direction line within 5
    days and the same amount (±0.5). Confirm the match it finds (or pick from
    several candidates) and it writes a match row on **both** transactions in
    one call — both end up `recon_status = 'transfer'`, and neither counts as
    real income or a real expense for either entity, because no money actually
    left or entered the business.
11. **A debit with nothing to match**: two options.
    - **Create Expense** — pick an expense type and (optionally edit) a
      description, then click **Create Expense**. This inserts a brand-new
      `expenses` row on the spot (`source: 'bank_recon'`, `entity_key`/
      `payment_account` taken from the bank account itself) and links it in
      one call. **This is a second, independent way to create an expense**,
      distinct from the main Expenses page's `POST /api/expenses` — both write
      the same table, so any future schema change to `expenses` has to be kept
      in sync in both places.
    - **Raise PO task** — for a genuine unpapered purchase (no PO raised yet,
      nothing received). Creates a real `activities` task (due in 5 days,
      tagged `bank-recon`, linked to the vendor if one is known) and marks the
      transaction `explained` with a note pointing at the task — so the
      session can still close without silently losing track of the debit.
12. **Explain / Ignore**: for a row that needs no linked record at all (a bank
    fee already booked elsewhere, an interest credit, a reversal). You're
    prompted for an optional note. `explained` and `ignored` are the only two
    states the system never overrides on its own — everything else
    (`open`/`split`/`matched`/`transfer`) is derived automatically from
    whatever matches exist.

## Common mix-ups

- **"I can't find where to match a transaction on the Bank Recon page."**
  That page is deliberately import + read-only review only — go to **Recon
  Sessions** to actually match, split, transfer, explain, or expense a line.
- **"I matched the wrong candidate — how do I undo it?"** The underlying route
  (`DELETE /api/bank-transactions/[id]/match/[matchId]`) is built to be
  reversible and doesn't delete the linked expense/sale-payment/vendor-payment
  row, only the link — but as of this writing **no button in either recon page
  calls it**. Undoing a bad match currently means going through the API
  directly (or asking for the row to be corrected) rather than clicking
  something in the UI.
- **"The transaction list only shows some rows."** Recon Sessions only
  displays transactions still `open` or `split` for the selected account and
  month — a row that's already `matched`/`explained`/`ignored`/`transfer`
  drops out of that list (the Bank Recon page's own list shows everything, but
  read-only).
- **"Why did an expense typed through bank recon show up with a payment
  account I didn't pick?"** It's always the bank account's own entity
  (Digitalbluez/Techtenth/Cash), title-cased — there's no separate account
  picker in the Create Expense flow the way there is on the main Expenses
  page.

## Related

**manage-recon-sessions** (what groups these transactions into a closeable
unit), **record-a-vendor-payment** (the same ledger a PO-matched debit writes
into), **reconciliation** (module overview, including the cash-never-touches-a-
bank-statement limitation), **expenses** (the data model this recon-created
row shares with the main Expenses page).
