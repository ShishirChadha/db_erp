---
slug: create-a-quotation-or-proforma
title: Creating a Quotation or Proforma Invoice
kind: process
module: sales-invoicing
audience: [owner, manager, employee]
routes: [/dashboard/quotations, '/dashboard/quotations/[id]', /dashboard/entry/sell]
keywords: [quotation, proforma, proforma invoice, estimate, price quote, rate quote, daam batana, quote dena, valid until, convert to sale, non-committal offer]
sources:
  - apps/erp/app/dashboard/quotations/page.tsx
  - apps/erp/app/dashboard/quotations/[id]/page.tsx
  - apps/erp/components/SalesDocumentForm.tsx
  - apps/erp/app/api/sales-documents/route.ts
  - apps/erp/app/api/sales-documents/[id]/route.ts
  - apps/erp/app/api/sales-entry/route.ts
updated: 2026-09-16
---

## What this is

A non-committal price offer (**Quotation**, with an optional Valid Until date)
or a provisional-not-tax document (**Proforma Invoice**) sent to a customer
before any real sale happens. Neither ever touches inventory or mints a real
invoice number — only converting a line to a sale does that.

## Who can do this

**Viewing** the Quotations & Proforma Invoices list/detail pages needs the
`quotations` page grant (owner always has it; manager/employee need it
granted via allowed_pages in Settings → Users & Access). **Creating, editing,
and status changes** need the `quotations` **edit** grant — the same
per-page edit model every other module uses, so this isn't owner-exclusive.

## Steps

1. Open **Quotations & Proforma Invoices** (`/dashboard/quotations`) and
   pick the Quotations or Proforma Invoices tab.
2. Click **New Quotation** / **New Proforma Invoice**.
3. Choose the entity (Digitalbluez / Techtenth / Cash — determines GST
   treatment), pick or quick-add the customer, and for a quotation
   optionally set Valid Until.
4. Add line items — search a SKU by model/code (auto-fills description,
   HSN, the SKU's default selling price, and 18% GST) or add a free-text
   "Custom line" — and set qty/rate/GST% per line.
5. Optionally add notes/terms. Save. This mints a real, sequential document
   number via the same kind of atomic numbering RPC used everywhere else in
   the app (its own series, separate from the DBI invoice series), and
   computes subtotal/GST/grand total server-side.
6. From the document's detail page, move it through **Mark Sent / Mark
   Accepted / Mark Rejected / Void**, and preview/download/email/print the
   PDF.

## Converting a line to a real sale

Each line item has its own **Convert →** action. Clicking it opens **New
Entry → Sell** in a new tab, pre-filled with the document's customer, the
line's rate and GST%, and (for a SKU line) a search prefill — converting is
really just handing off to the normal Sell flow with the numbers already
typed in. Submitting that sale marks the source line `converted = true` and
links it to the new `sales` row; this update happens best-effort *after* the
sale succeeds, so a failure here never blocks or undoes the sale itself.

Lines can be converted independently, at different times — nothing forces
converting a whole document at once. The list page shows a running
"N / M converted" count so partially-converted documents are visible at a
glance.

## Editing constraints

Customer/entity/line items can only be edited while the document is still
`draft` or `sent` **and** no line has been converted yet. Once either
condition no longer holds (status moved past draft/sent, or even one line
converted), the PATCH route rejects the edit with a 409 — the detail page
hides the Edit button in that case too. The fix is to **void the document
and create a fresh one**, preserving the original exactly as it was
sent/quoted. Status changes, notes, and terms/valid-until stay editable
regardless of conversion state.

## Common mix-ups

- **"I can't edit this quotation anymore."** — Check whether any line was
  already converted, or the status moved past draft/sent; either one locks
  content edits. Void it and start a new one instead of fighting the error.
- **"Converting a line didn't create an invoice."** — It only creates a
  `sales` row, same as any other sale — the GST invoice is separate,
  deferred paperwork (see **raise-a-gst-invoice**).
- **"Can I convert different lines to different customers?"** — No; the
  Convert action always uses the document's own single customer, prefilled
  into the Sell page.
