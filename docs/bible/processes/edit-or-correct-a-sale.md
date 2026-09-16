---
slug: edit-or-correct-a-sale
title: Editing or Correcting a Sale
kind: process
module: sales-invoicing
audience: [owner, manager, employee]
routes: [/dashboard/sales, '/dashboard/stock/[id]', /dashboard/repair-jobs]
keywords: [edit sale, correct sale, sale correction, void sale, cancel sale, galti sudharna, sale delete karna, invoice file attach, sale history, bundled accessories, change SKU]
sources:
  - apps/erp/components/EditSaleDialog.tsx
  - apps/erp/components/AttachInvoiceFileDialog.tsx
  - apps/erp/app/api/sales/[id]/route.ts
  - apps/erp/app/api/sales/[id]/void/route.ts
  - apps/erp/app/api/invoices/[id]/attachments/route.ts
updated: 2026-09-16
---

## What this is

Correcting an already-recorded sale (customer, price/GST, sold-by, date,
payment account, notes, bundled accessories) after the fact, or fully
reversing a mistaken sale (void). Separate from topping up a partial payment
(`AddPaymentDialog` inside the same dialog — see **record-a-part-payment**)
and separate from attaching a missing Zoho invoice PDF
(`AttachInvoiceFileDialog`, covered here too since it's reachable from the
same sale row).

## Who can do this

- **View** a sale's detail: any role with access to Live Stock, Sales, or
  Stock (whichever page the dialog was opened from — `GET /api/sales/[id]`
  accepts any of those three page grants).
- **Edit** a sale's fields (`EditSaleDialog`'s Save): the owner, or anyone
  with an edit grant on the `live_stock`, `sales`, or `stock` page — not
  owner-exclusive.
- **Void** a sale, edit/remove a payment's recorded date, or attach an
  invoice file: owner only — these controls are hidden from the dialog
  entirely for non-owners.

## Steps — editing a sale

1. Open **Edit Sale** from the Sales Ledger (or the sale-details panel on
   Live Stock/Stock).
2. Change customer, sold-by, sale date, sale type (GST/Cash), price (toggle
   between pre-GST and GST-inclusive entry, same convention as the Sell
   form), GST%, default payment account, or notes.
3. For a unit sale (one with an `asset_ledger_id`), add/remove/change
   quantities of bundled accessories, or use **Change SKU** (`FixSkuDialog`)
   if the unit was logged against the wrong SKU.
4. Save. If the sale is already invoiced (`finalized = true`) and you're
   changing price, GST, or bundled accessories, you'll be warned that this
   will **not** update the already-generated invoice — it's a frozen
   snapshot. Confirm to proceed anyway, or cancel and handle it differently.
5. Every field change is written to the sale's correction history (visible
   via "Show correction history"), with an optional reason.

## What stays locked

- `payment_status` / `amount_paid` are never directly editable here — both
  are trigger-derived from the sum of `sale_payments`. Use **Add Payment**
  inside the same dialog to record a new installment, or remove an
  erroneous one (owner only).
- A voided sale (`is_deleted = true`) is entirely read-only — Save and Void
  both disappear, leaving only the correction history for reference.
- An already-generated invoice is never retroactively rewritten by a sale
  edit — the sale and the invoice can end up disagreeing, which is exactly
  why the confirmation step exists.

## Voiding a sale

Owner-only, and requires a typed reason. This is for a sale that was wrong
from the start (test entry, mis-click, duplicate) — the unit never actually
left, so stock reverses straight back to sellable (skipping QC entirely)
and the sale is soft-deleted (`is_deleted = true`, filtered out of every
list query). It's distinct from an RMA "from customer" return, which is for
a unit that physically came back and needs re-QC. If the sale is already
invoiced, voiding it requires the same "confirm despite invoice"
step — voiding doesn't retract or update that invoice either.

## Attaching a missing invoice file

Once a sale is finalized against a **Zoho-recorded (external)** invoice, a
"File" link appears next to the invoice number for the owner — it opens
`AttachInvoiceFileDialog` against that invoice's own `invoice_id` (not the
sale itself). It lists whatever's already attached and lets you add
another; uploads append/dedupe rather than replace, so nothing gets
silently dropped. This link only ever appears for external/Zoho invoices —
an ERP-generated invoice always has its own PDF rendered on demand via
`/api/invoices/[id]/pdf`, so there's nothing to attach.

## Common mix-ups

- **"I changed the price but the PDF/printed invoice still shows the old
  number."** — Expected: editing a sale never rewrites an already-generated
  invoice. Reissue/void the invoice manually if it truly needs to change,
  or edit the sale before generating/recording its invoice next time.
- **"I don't see a Void button."** — Only the owner sees it; anyone else
  with edit access can still fix fields but can't void.
- **"Where do I attach the Zoho PDF?"** — Only appears after the sale is
  finalized against an external invoice; it's not available before that,
  and never appears for ERP-generated invoices.
