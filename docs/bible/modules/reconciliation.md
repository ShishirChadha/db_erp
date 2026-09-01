---
slug: reconciliation
title: Reconciliation (Vendor, Invoice, Bank)
kind: module
audience: [owner]
routes: [/dashboard/recon/vendors, /dashboard/recon/bank, /dashboard/recon/sessions]
keywords: [reconciliation, recon, bank statement, vendor invoice, upload invoice, CSV import, match transactions, GSTIN, vendor payment, unmatched, close session, dedup, continuity check, expense from bank, transfer pair]
sources:
  - apps/erp/lib/recon/**
  - apps/erp/app/api/documents/**
  - apps/erp/app/api/vendor-recon/**
  - apps/erp/app/api/bank-accounts/**
  - apps/erp/app/api/bank-statements/**
  - apps/erp/app/api/bank-transactions/**
  - apps/erp/app/api/bank-categorization-rules/**
  - apps/erp/app/api/recon-sessions/**
  - apps/erp/app/api/purchase-orders/[id]/payments/**
  - apps/erp/app/dashboard/recon/**
updated: 2026-09-01
---

## What this covers

Owner-only reconciliation across two source materials: a bank statement
(matched against sale payments, vendor payments, and expenses) and a vendor's
invoice PDF header (used to correct the vendor master, and to feed AI-token
economy via saved per-vendor templates). Every page here is `ownerOnly` — see
**roles-permissions**.

**Invoice line reconciliation (invoice → PO/PI stock matching) was removed
2026-08-31** — the owner found the automated invoice-line-to-stock matching
unreliable in practice after several rounds of fixes (trigram false positives/
negatives, category confusion) and asked for it to be dropped entirely. The
`invoice_match_sessions`/`invoice_match_lines`/`invoice_match_candidates`
tables and the `match_skus_for_invoice_line` RPC were dropped; the
`/dashboard/recon/invoices` page and `/api/invoice-recon/**` routes were
deleted. Nothing had ever been committed through it (both live sessions were
still `reviewing`), so no PO/PI/invoice data was affected. Vendor and Bank
Reconciliation are unrelated to this and continue to work as before — matching
a vendor invoice against stock for a PO is manual again, the same as before
this session's work began.

## Key concepts

- **The document pipeline is shared.** `uploaded_documents` + `extraction_templates`
  serve both vendor invoices and bank statements. A PDF is probed for a real
  text layer first (Tier 0, free), then a saved per-vendor/per-bank template is
  tried (Tier 1, free — a template is regex rules learned from one AI parse via
  "Save layout", never a second AI call), and only then does the owner get an
  explicit **"Read with AI"** button (Tier 2 — never called automatically, and
  the route itself refuses without `confirm: true` in the body as a second
  gate). Bank statements normally skip AI entirely — ICICI-style CSV export is
  the primary path (`papaparse`, client-side column mapping saved once per
  account in `bank_column_profiles`). See `lib/recon/pdf-text.ts`,
  `lib/recon/ai-extract.ts`, `lib/recon/validate.ts` — the last of these is the
  non-negotiable rule that a model transcribes but never certifies its own
  totals; every extraction is re-derived from its own line items and flagged
  `needs_review` on any mismatch.
- **Vendor reconciliation** (`/dashboard/recon/vendors`) resolves an invoice's
  vendor by GSTIN exact match → trigram name match (`match_vendors_by_name`,
  pg_trgm) → a template's known vendor, then proposes field corrections
  (`vendor_correction_proposals`) — fill / conflict / derived (a valid GSTIN on
  the invoice always derives `has_gst = true`). An invoice field the vendor
  record already has but the invoice doesn't print is **never** proposed as a
  blank-out. Approving a proposal writes through the existing
  `logFieldCorrections()` ledger, so it's reversible via the existing
  `/api/audit-log/.../restore-soft-delete`-style revert route with no new code.
  `city`/`pincode` are compared like any other field (`vendor_city`/
  `vendor_pincode` in the extraction schema — added 2026-08-31 after they were
  found dead-wired to `undefined` and never actually proposed). **Phone is
  handled as two independent slots** (`vendors.phone`, `vendors.alt_phone`) —
  an invoice can print two numbers; the primary invoice number fills/conflicts
  `phone` on its own terms, and a second invoice number only ever proposes a
  fill into `alt_phone` (never a conflict), and only once, so re-uploading the
  same invoice never re-proposes an already-known number in either slot.
  **When no vendor resolves confidently**, the page offers a live search across
  every vendor (not just trigram candidates) plus an inline "Create new vendor"
  (reuses `AddVendorDialog`) — added 2026-08-31 so an unmatched invoice never
  dead-ends at "go create one elsewhere." The dialog is pre-filled (2026-09-01)
  from the invoice's own AI/template extraction (`buildVendorPrefill` in the
  vendor-recon page) — only non-empty extracted fields are set, so the owner
  corrects a mostly-right form instead of retyping the vendor's letterhead.
- **Bank reconciliation** (`/dashboard/recon/bank`, `/dashboard/recon/sessions`)
  imports a statement (`bank_statements`/`bank_transactions`), deduplicating on
  a server-computed hash of the row's own values (never a client-supplied key)
  and running a balance-continuity check (opening+net=closing, plus a running-
  balance chain check that catches a dropped mid-statement row the totals-only
  check can miss). Matching writes to `bank_transaction_matches` — a many-to-
  many join (one credit can settle several sale_payments, one debit can be
  split) with a trigger-enforced amount cap and a trigger-derived
  `bank_transactions.recon_status` (`open`/`split`/`matched`/`transfer`), which
  never overrides an owner's explicit `explained`/`ignored` call
  (`/api/bank-transactions/[id]/explain`). An inter-entity transfer
  (`match_type='transfer_pair'`) writes a match row on **both** legs (possibly
  in different `bank_accounts`) in one call. A debit that isn't a purchase
  becomes a real `expenses` row on the spot (`match_type='expense'`,
  `source='bank_recon'`) — see **expenses** for the full data model this
  relies on (`payment_account`/`entity_key`/`vendor_id`, and its type list
  lives in `custom_options` category `expense_types`, not a hardcoded array).
  This is a second, independent expense-creation code path alongside
  `POST /api/expenses` — the two must be kept in sync on any future schema
  change to `expenses`.
- **`recon_sessions`** is the actual "keep going until nothing's left" loop —
  one row per bank account + period, `open_count` always recomputed fresh (never
  trusted stale) before a close is allowed, and reopening a closed session is
  an audited action. A session's summary also runs a **recurring-expense
  watch**: a type with an active `recurring_expense_rules` entry for this
  account's entity that has real expense history in an earlier period but no
  matching expense in the current one is flagged — a missing recurring cost is
  easier to miss than an unexpected one. This was a hardcoded `['Rent',
  'Electricity', 'Internet']` array until 2026-09-01, when it switched to
  reading from `recurring_expense_rules` instead, so there's one definition of
  "what counts as recurring" — see **expenses** for the real, schedulable
  mechanism (`scan_recurring_expenses()`, a daily `pg_cron` job) this on-demand
  watch now shares its type list with.
- **`vendor_payments`** (the debit-side twin of `sale_payments`) is what makes
  bank-debit matching against a PO possible at all — a PO's `grand_total` only
  ever recorded what's owed, never what was paid, before this. Same append-
  only-ledger, trigger-derives-totals posture as `sale_payments`; see the
  payments panel on the PO detail page.

## Known limitation

Cash never touches a bank statement — 219+ cash POs and cash sales are outside
this system's reach by design; a cash book with a physical count is a
different, unbuilt mechanism. Bank recon reports cash as an excluded bucket
rather than silently pretending the numbers tie.

## Related

**purchasing** (PO/PI creation stays a manual flow — see above), **expenses**
(the data model this recon-created row shares with `POST /api/expenses`, and
the recurring-rules table the watch above now reads), **business-rules**
(the vendor cost/vendor-identity redaction rule), **roles-permissions**
(every recon page and route is owner-only),
**finance-gst-reports** (GSTR-2B-vs-purchase-invoice matching is the highest-
value reconciliation not yet built).
