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
updated: 2026-10-11
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
   changing price, GST, or bundled accessories, you'll be warned and must
   confirm ("confirm despite invoice") to proceed.
5. Every field change is written to the sale's correction history (visible
   via "Show correction history"), with an optional reason.

**Since 2026-10-11**, confirming that warning for `sale_base_price`/
`sale_gst`/`sale_total` no longer leaves the invoice stale: the matching
`invoice_items` row (found via `sale_id`, only populated for invoices
generated after 2026-09-28 — an older invoice's line has no `sale_id` and is
skipped, best-effort) is updated in lockstep (`rate`/`amount`, and
`cgst_amount`/`sgst_amount`/`igst_amount` re-split by the item's existing
intra-/inter-state shape), and the parent `invoices` row's
`subtotal`/`total_gst`/`grand_total` (and legacy `total_amount`/`gst_total`)
are recomputed from every line on that invoice, not just the edited one —
a multi-sale invoice stays internally consistent. `payment_status` on the
invoice is also recomputed (`paid` only if every sale on it is `paid`). This
was added after two real cases (`DBI2026/27-00726`, `DBI2026/27-00736`)
where a post-invoice price edit silently desynced the invoice from Zoho's
copy, and surfaced as a GST reconciliation mismatch weeks later.
Bundled-accessory changes and edits to invoices with no `sale_id`-linked
item still don't sync — those remain genuinely frozen; see below.

## What stays locked

- `payment_status` / `amount_paid` are never directly editable here — both
  are trigger-derived from the sum of `sale_payments`. Use **Add Payment**
  inside the same dialog to record a new installment, or remove an
  erroneous one (owner only).
- A voided sale (`is_deleted = true`) is entirely read-only — Save and Void
  both disappear, leaving only the correction history for reference.
- Bundled-accessory changes, and edits to a sale whose invoice line has no
  `sale_id` (invoices generated before 2026-09-28), are **not** synced to
  the invoice — those stay frozen, which is exactly why the confirmation
  step still exists for every field.

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
  number."** — Since 2026-10-11 this only happens for bundled-accessory
  edits or invoices older than 2026-09-28 (no `sale_id` link to sync
  against); a base-price/GST/total edit on a newer invoiced sale now
  updates the invoice automatically. If it still looks stale, check which
  of those two exceptions applies before assuming a bug.
- **"I don't see a Void button."** — Only the owner sees it; anyone else
  with edit access can still fix fields but can't void.
- **"Where do I attach the Zoho PDF?"** — Only appears after the sale is
  finalized against an external invoice; it's not available before that,
  and never appears for ERP-generated invoices.
