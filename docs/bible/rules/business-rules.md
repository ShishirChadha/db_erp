---
slug: business-rules
title: Business rules that must not be violated
kind: rule
audience: [owner, manager, employee]
routes: []
keywords: [rules, policy, invariant, must not, redaction, cost price, vendor, margin, approval, employee entry, immediately real, numbering, appointment number generation]
sources:
  - CLAUDE.md
updated: 2026-08-29
---

## Entries are immediately real — there is no owner-approval gate

When an employee records a stock-in or a sale, it is true in the system the
moment they submit it. Inventory moves at entry time. The owner's job is
**deferred bookkeeping** (attach a PO, generate an invoice), tracked by
**derived flags** — `asset_ledger.po_id IS NULL`, `sales.finalized` — never a
separate status column that a human has to remember to set and can drift out
of sync.

**Why:** an earlier version of this system had a two-stage capture →
owner-approves flow. It was reversed after real use — an approval gate meant
the stock/sold lists weren't trustworthy for real-time warranty lookups, and
it put the owner in the middle of every transaction.

## Cost, vendor, and margin are owner-only — with one narrow, deliberate exception

Employees never see purchase cost, vendor identity, or margin, anywhere in the
UI or an API response, for laptops/desktops/monitors/tablets.

**The one exception (2026-08-24, accessories only):** the vendor + unit price
captured at the moment someone *receives* accessory stock is visible to every
role, by deliberate owner decision — it helps staff who are physically
receiving a delivery know what they're looking at. This does **not** relax
anything about the formal PO-attach vendor/cost, which stays owner-only exactly
as before, and it does not extend to any laptop/desktop/monitor/tablet cost data
under any circumstance.

The employee-visible vendor **list** is also scoped: `vendors.supplies_accessories`
(owner-set) gates which vendors even show up for a non-owner — a laptop-only
vendor is never exposed to an employee, not even by name.

## Only the owner can

Attach units to a PO, generate invoices, edit SKU master data, manage vendors
(edit/delete/tag any existing vendor — see the accessory-vendor exception
above for the one thing an employee *can* do), manage dropdown-option lists.

**Repair job status/payment fields are the exception to "owner only":** they're
gated by the page's own edit grant, not owner-only — matching the general
principle that operational data entry is not an owner-exclusive act, only
cost/vendor/margin visibility is.

## Sale payments are an append-only ledger, not an editable field

`sales.amount_paid` / `payment_status` are **trigger-derived** from the sum of
`sale_payments` rows. Any role can record a new installment — an employee
taking a customer's 2nd or 3rd payment logs it themselves, the same
"immediately real" principle as the sale itself. Only the owner can delete/
correct an erroneous payment entry, or edit which payment account it was
recorded against.

**Never write `amount_paid`/`payment_status` directly from application code.**
If you're tempted to, you're looking for the wrong table — add a `sale_payments`
row instead and let the trigger do its job.

## Numbering always goes through the atomic RPC — never a manual counter

Asset numbers, PO numbers, invoice numbers, repair job numbers: each has its
own RPC (`reserve_assets`, `generate_po_number`, `increment_invoice_number`,
`generate_repair_job_number`). A client-side MAX-scan or manual increment can
race under concurrent use and hand out a duplicate number — the RPC can't.

## Asset numbers are a Purchase Order artifact, not proof a unit exists

A unit can be QC'd, sold, and returned entirely by `serial_number` before it
ever has a PO or an asset number — `asset_ledger.asset_number` stays `NULL`
from intake through QC through sale. It's only assigned when a real PO exists,
via `reserve_assets()`, called only from the PO-attach flow. **Never add an
asset-number requirement anywhere in the day-to-day QC/sell/service flow** —
QC and purchase-paperwork happen on independent schedules, and a unit is
routinely sold before its PO paperwork is ever touched.

## Tasks (Activities) never carry cost/vendor/margin

If a task's UI previews a linked business record (a sale, a PO, an asset), that
preview must come from the **existing redacted endpoint** for that record
(e.g. `/api/stock`), never a fresh, unredacted query written just for the task
preview.

## The two buying/payment entities are one business, not separate vendors

Digitalbluez and Techtenth are two payment/entity identities under one
business — not competitors, not separate companies with separate stock. See
**finance-gst-reports** for how this shows up in GST/invoicing.

## API-layer role enforcement, not RLS, not middleware

Almost every route uses the Supabase service-role client, which bypasses RLS
entirely — so a tightened RLS policy alone would not close an exposure. There
is also no `middleware.ts`. The real boundary is `lib/auth/session.ts` +
`lib/auth/redact.ts`, checked inside each route handler. Page-level guards
(`RequireOwner`) are UX only, never the actual security boundary — see
**roles-permissions**.
