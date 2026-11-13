---
slug: raise-a-gst-invoice
title: Raising a GST invoice
kind: process
audience: [owner, manager]
module: sales-invoicing
routes: [/dashboard/invoices/new, /dashboard/invoices]
keywords: [invoice, gst invoice, raise invoice, generate invoice, billing, tax invoice, DBI number]
sources:
  - apps/erp/app/api/invoices/**
  - apps/erp/lib/invoice-finalize.ts
  - apps/erp/components/InvoiceForm.tsx
  - apps/erp/app/dashboard/invoices/new/page.tsx
  - apps/erp/app/actions/invoice.ts
updated: 2026-11-13
---

## What this is

Turning one or more already-recorded sales into a formal, numbered GST
invoice. Separate from the sale itself — a sale is real the moment it's
entered; the invoice is deferred paperwork the owner does whenever they get
to it. Can combine multiple sale line items into a single invoice document.

## Steps

1. Open **Sales Ledger** (`/dashboard/sales`) — or a sold unit on Stock, or
   a billed repair job — and choose **Generate Invoice**.
2. Select the sale(s) to include (unfinalized sales for the relevant
   customer/entity).
3. Confirm the line items, GST breakdown, and which entity (Digitalbluez /
   Techtenth) the invoice is under — this determines GST treatment (home
   state UP-09 for Digitalbluez; see **finance-gst-reports**).
4. Generate. The invoice number is minted via the atomic numbering RPC (DBI
   series, continuing from wherever the FY series left off) — never a manual
   guess. This also flips the linked sale(s) `finalized`. The customer's
   billing address (`customers.address`) and shipping address
   (`customers.shipping_address`) are snapshotted onto the invoice as
   `customer_address` / `shipping_address`; the PDF prints Ship To, falling
   back to the billing address when the customer has none.

## Manual invoice (Invoices → New) and Clone

**Invoices → New** (`/dashboard/invoices/new`) is a separate, manual form
for a standalone invoice that isn't generated from a sale (its lines carry no
`sale_id`, so it moves no stock and finalizes no sale).

- **Layout** — the same as the Quotation/PI entry form: Entity with the
  number under it, Invoice Date and an optional Place of Supply override
  beside them, customer picker (with quick-add) showing a read-only **Bill
  To** snapshot and an editable **Ship To**, then the item table, and Notes /
  T&C / Bank Details. Customer details are changed on the customer record, not
  typed per invoice. Cancel leaves without saving.
- **Number** — shown directly under Entity as a read-only preview
  (`GET /api/invoices/next-number`); nothing is reserved, so leaving the form
  burns no number. `mintInvoiceNumber()` mints the real one on save (it
  checks the caller's `invoices` edit grant) and says so if the preview was
  taken meanwhile.
- **Zoho transition mode** — for an entity with `invoicing_mode = 'external'`
  the form shows a warning and won't save, and `mintInvoiceNumber()` refuses
  too: that entity's legal series is still issued in Zoho (same rule as
  `getInvoicingMode()` in invoice-finalize).
- **Item table** — same Zoho layout as Quotations/PI (see
  **create-a-quotation-or-proforma**): HSN/SAC under each item, mandatory
  for a GST-registered entity and hidden otherwise; Tax dropdown; **Tax
  Exclusive / Inclusive** switch (inclusive rates are reduced to the pre-GST
  `rate` on save); every line shows Base, CGST+SGST or IGST, and Total, and
  the totals box splits the tax the same way. Place of supply: explicit
  field → customer GSTIN prefix → entity's own state.
- **Stored amounts** — `invoice_items.amount` is the **GST-inclusive** line
  total, the same convention the sale-to-invoice path and "+ Add Charge"
  use (the form used to store the pre-GST amount, which understated Grand
  Total after an Add Charge). `invoices.total_amount` = pre-GST subtotal.
- **Notes / T&C** — prefilled from the entity's defaults (Settings →
  Business Profiles).
- **Clone** (invoice detail toolbar, not on credit notes) opens this form
  prefilled via `?clone=<id>`: customer, place of supply, addresses,
  notes/terms/bank details and lines (as standalone custom lines — sale and
  asset links are dropped, with a warning banner). Fresh date, draft status,
  new number on save; Cancel creates nothing.
- **Edit** (draft invoices only, which in practice means manual ones — invoices
  generated from sales are created `approved`) uses the same form with the
  entity locked.

## Related

**sales-invoicing**, **finance-gst-reports**, **business-rules** (numbering
rule).
