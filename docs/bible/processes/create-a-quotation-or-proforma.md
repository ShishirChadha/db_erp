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
  - apps/erp/app/api/sales-documents/defaults/route.ts
  - apps/erp/lib/sales-documents.ts
  - apps/erp/app/api/sales-entry/route.ts
  - apps/erp/lib/documents/renderSalesDocumentPdf.ts
updated: 2026-11-13
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
   treatment). Directly below it the form shows the **number this document
   will get** (e.g. `PI2026/27-00059`). That is only a read-only peek at the
   entity's counter (`GET /api/sales-documents/defaults`) — nothing is
   reserved, so **Cancel leaves no trace in the database and burns no
   number**. The real number is minted atomically on Save; if someone else
   saved first in the meantime you get the next one and a message saying so.
   Then pick or quick-add the customer, and for a quotation optionally set
   Valid Until. Once a customer is picked, **Bill To** shows
   their billing address (read-only) and **Ship To** is prefilled from their
   saved shipping address — edit it for this document only, or leave it
   blank to ship to the billing address. Both are snapshotted onto the
   document (`customer_address` / `shipping_address`), and the PDF prints
   them side by side.
4. Fill the **Item Table** (Zoho-style: Item Details / Quantity / Rate / Tax /
   Amount). Type in the "add an item" box to pull a SKU (auto-fills
   description, HSN, the SKU's default selling price, and 18% GST) or click
   **Add New Row** for a free-text line.
   - For a **GST-registered entity** (Digitalbluez) each line shows an
     **HSN/SAC** field under the item — **mandatory** (the form and both
     POST/PATCH routes reject a line without it) — plus a **Tax** dropdown
     and an **Amounts are Tax Exclusive / Tax Inclusive** switch, the same
     Before/After GST choice as the Sell page. In Inclusive mode rates are
     typed GST-included and reduced to their pre-GST base on save (the
     server always stores pre-GST `rate`); switching modes converts every
     line so the customer's total stays the same.
   - For a **non-GST entity** (Techtenth/Cash) HSN, Tax and the switch are
     hidden — the rate is simply what the customer pays (Bill of Supply).
5. **Notes** and **Terms & Conditions** start prefilled with the entity's
   defaults from Settings → Business Profiles (see
   **manage-business-profiles**); edit freely. Save — this mints the number
   and computes subtotal/GST/grand total server-side.
6. From the document's detail page, move it through **Mark Sent / Mark
   Accepted / Mark Rejected / Void**, and preview/download/email/print the
   PDF.
7. **Clone** opens the same New form prefilled from the document (entity,
   customer, Ship To, line items, notes/terms; Valid Until left blank).
   Change anything, then Save (new number, new draft) or Cancel (nothing
   created). New, Edit and Clone all use one dialog
   (`SalesDocumentEditorDialog`).

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

Since the handoff lands in the normal Sell flow, a converted line can also be
marked as a GST exclusion (sample/gift/etc.) there like any other sale — see
**finance-gst-reports** — though that would be unusual for a line that came
from a priced quotation.

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
