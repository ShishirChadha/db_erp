---
slug: create-a-purchase-invoice
title: Creating a Purchase Invoice
kind: process
audience: [owner]
module: purchasing
routes: [/dashboard/purchase-invoices/new, '/dashboard/purchase-invoices/[id]']
keywords: [purchase invoice, vendor invoice, bill banana, PI, GST input credit, invoice against po, create invoice, generate purchase invoice]
sources:
  - apps/erp/app/dashboard/purchase-invoices/new/page.tsx
  - apps/erp/app/dashboard/purchase-invoices/[id]/page.tsx
  - apps/erp/app/api/purchase-invoices/route.ts
  - apps/erp/app/api/purchase-invoices/[id]/route.ts
updated: 2026-09-16
---

## What this is

Recording the vendor's actual invoice/bill against a Purchase Order — the
document that carries the GST input-credit figures for bookkeeping. This is
distinct from the PO itself: a PO is *your* purchase paperwork (what you
ordered/received); a Purchase Invoice is the vendor's bill for it, one per
PO.

## Who can do this

Owner only. Every route under `/api/purchase-invoices` (`GET` list, `POST`
create, `GET`/`DELETE` detail) checks `isOwner(sessionUser)` and returns
`403` otherwise — there is no manager-view carve-out here the way Purchase
Orders has one. Both pages are wrapped in `RequireOwner`.

## Steps

1. Open **Purchase Invoices → New Invoice**, optionally pre-selecting a PO
   via `?po_id=` (the "Create Invoice" button on a PO's detail page links
   here this way once the PO is `submitted`/`partially_received`/`received`/
   `invoiced`).
2. **Select the Purchase Order** — the dropdown lists non-draft, non-cancelled
   POs (`submitted, partially_received, received, invoiced`).
3. Total Amount, GST Total, and Grand Total auto-fill from the PO's own
   totals the moment it's selected, but all three remain editable in case the
   vendor's actual bill differs slightly from the PO.
4. Enter the **Invoice Number** and **Invoice Date** (both required), set
   **Payment Status** (`pending` / `partial` / `paid`), optional notes, and
   optionally attach the vendor's PDF/image (uploaded via a signed URL into
   private storage, not a public bucket).
5. Submit. This:
   - blocks with a `409` if an invoice already exists for that PO — **one
     Purchase Invoice per PO**, no duplicates;
   - if the PO is currently `submitted`, `partially_received`, or `received`,
     automatically advances it to `po_status = 'invoiced'`.

## What happens next / is it frozen?

There is **no edit route** for a Purchase Invoice — `[id]/route.ts` only
exposes `GET` and `DELETE`, no `PUT`/`PATCH`. Once created, an invoice's
number, date, and totals are effectively a frozen snapshot; the only way to
"correct" one is to **delete it and create it again**. Deleting:

- permanently removes the invoice row (hard delete, no restore handler wired
  up for it — the audit log entry is captured for visibility only, with
  `restoreStatus: 'not_applicable'`);
- reverts the linked PO's status intelligently based on what's actually been
  received so far (`received` if every line is fully received, otherwise
  `partially_received` or back to `submitted`) — it does **not** blindly
  reset to `received`.

Vendor payments are **not** recorded per-invoice — they're recorded once
against the PO itself (`AddVendorPaymentDialog`, same component the PO detail
page uses) and the invoice detail page just displays that same PO-level
ledger filtered to its `po_id`.

## Common mix-ups

- **"I need to fix a typo on an invoice."** — there's no edit; delete it and
  re-create it. The PO's own vendor/date/items can still be corrected
  separately via **po-corrections** if the underlying PO data was wrong.
- **"Why can't I create a second invoice for this PO?"** — deliberate; the
  `409 Conflict` on `po_id` already having an invoice is a hard rule, not a
  race condition.
- **"I recorded a vendor payment but it's not showing on the invoice."** —
  payments live against the PO, not the invoice row; check the PO detail
  page, or confirm `po_id` matches.
