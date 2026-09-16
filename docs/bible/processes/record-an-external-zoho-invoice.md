---
slug: record-an-external-zoho-invoice
title: Recording an External (Zoho) Invoice
kind: process
module: sales-invoicing
audience: [owner]
routes: [/dashboard/sales, /dashboard/invoices/import, /dashboard/invoices]
keywords: [zoho, zoho invoice, external invoice, record invoice, backfill invoice, import invoice, purana invoice, invoice number dalna, historical invoice, transition mode, invoicing_mode]
sources:
  - apps/erp/components/RecordZohoInvoiceDialog.tsx
  - apps/erp/app/dashboard/invoices/import/page.tsx
  - apps/erp/app/api/sales/record-external-invoice/route.ts
  - apps/erp/app/api/invoices/import/route.ts
  - apps/erp/lib/invoice-finalize.ts
  - apps/erp/components/AttachInvoiceFileDialog.tsx
  - apps/erp/app/api/invoices/[id]/attachments/route.ts
updated: 2026-09-16
---

## What this is

This business is mid-transition from Zoho to the ERP's own invoicing (see
**raise-a-gst-invoice**). Two distinct, owner-only tools exist for the Zoho
side of that transition:

- **Record Zoho Invoice #** (`RecordZohoInvoiceDialog`, opened from the
  Sales Ledger) — records that Zoho already issued a real invoice number for
  one or more already-recorded `sales` rows, linking those sales to it and
  marking them done. For **live, ongoing** sales.
- **Import Invoice** (`/dashboard/invoices/import`) — a standalone form that
  creates an `invoices` row (with its own line items) directly, with **no
  link to any `sales` row at all**. For **backfilling history** — old Zoho
  invoices that predate the ERP or were never entered here as sales.

Both preserve the real Zoho number verbatim and never call the ERP's own
atomic invoice-numbering RPC — so neither can ever collide with or skip
ahead of the live DBI series (`invoice_sequences` is only ever advanced by
that RPC, and these routes never touch it).

## Who can do this

Owner only. Both `POST /api/sales/record-external-invoice` and
`POST /api/invoices/import` return 403 for anyone else, regardless of any
page-edit grant.

## When to use which

- A sale is already sitting in the Sales Ledger, `finalized = false`, and
  Zoho was used to issue its invoice → **Record Zoho Invoice #**.
- You're entering the business's history — an old invoice with no
  corresponding `sales` row in this system → **Import Invoice**.
- An entity must be in Zoho **transition mode**
  (`business_profiles.invoicing_mode = 'external'`, set in Settings →
  Business Profiles) for "Record Zoho Invoice #" to work at all — once that
  entity has switched to `erp` mode, the route rejects with a message
  pointing you to **Generate Invoice** instead.

## Steps — Record Zoho Invoice #

1. From the Sales Ledger, select one sale — or several sales for the same
   customer paid into the same account/entity — not yet finalized.
2. Open **Record Zoho Invoice #**, enter the real Zoho invoice number (e.g.
   `DBI2026/27-00695`) and the invoice date.
3. Optionally attach the Zoho-issued PDF.
4. Save. The ERP records the number as-is, creates/links the `invoices` row
   with `source = 'imported_zoho'`, and marks the linked sale(s)
   `finalized`.
5. If that exact invoice number already exists as another `imported_zoho`
   invoice for the **same customer and entity**, the new sale(s) are
   appended as extra line items to the existing invoice instead of
   erroring — Zoho commonly combines several sales (e.g. 3 laptops sold the
   same day) that weren't all selected together in the ERP the first time.
   Any other number collision (different customer/entity, or an
   ERP-generated invoice) is hard-blocked as a likely typo.

## Steps — Import Invoice

1. Open **Invoices → Import Historical Invoice**
   (`/dashboard/invoices/import`).
2. Pick the entity, type in the invoice number and date exactly as Zoho
   issued them, and the customer (search an existing one, or type the name
   freehand — `customer_id` is optional here, unlike a live sale).
3. Add line items (description, HSN, qty, rate, GST% if the entity is
   GST-registered) — no link to any SKU, asset, or sale is required.
4. Import. This inserts directly into `invoices`/`invoice_items` with
   `source = 'imported_zoho'`, `status = 'sent'`, `payment_status = 'paid'`.
   It never touches `invoice_sequences` and never creates a `sales` row.
5. A duplicate invoice number is rejected outright here — no append
   behavior, since there are no sales to merge against.

## Attaching a file after the fact

If a Zoho invoice was recorded without its PDF at the time, a **File** link
appears next to that invoice number in the Sales Ledger (owner-only, and
only for external/Zoho invoices — an ERP-generated invoice always has its
own rendered PDF via `/api/invoices/[id]/pdf`, so there's nothing to
attach). It opens `AttachInvoiceFileDialog` against the invoice's own id —
attaching a file to the **invoice**, not the sale — and appends/dedupes
against whatever's already there rather than replacing it, so a re-upload
never silently drops an earlier file.

## Common mix-ups

- **"This entity won't let me record a Zoho number."** — It's already
  switched to `erp` invoicing mode; use Generate Invoice instead, or switch
  it back to Zoho transition mode in Settings → Business Profiles if that
  was a mistake.
- **"My invoice number already exists."** — If it's the same Zoho invoice
  covering more sales you forgot to select the first time, re-run Record
  Zoho Invoice # with the same number and the extra sale(s) — it appends.
  If it's an ERP-generated number or a different customer/entity, it's a
  genuine collision or typo; double-check before reusing the number.
- **"I used Import Invoice for a sale that's actually in the system."** —
  Don't; Import Invoice never links to or finalizes a `sales` row, so that
  sale would keep showing as unfinalized in the owner's invoicing queue. Use
  Record Zoho Invoice # instead so the sale gets marked done.
