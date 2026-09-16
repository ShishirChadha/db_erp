---
slug: sales-invoicing
title: Sales, Invoicing & Quotations
kind: module
audience: [owner, manager, employee]
routes: [/dashboard/sales, /dashboard/invoices, /dashboard/quotations, /dashboard/entry/sell]
keywords: [sale, sell, invoice, gst invoice, quotation, billing, bech, invoice number, DBI, sales ledger]
sources:
  - apps/erp/app/api/sales/**
  - apps/erp/app/api/sales-entry/**
  - apps/erp/app/api/invoices/**
  - apps/erp/lib/sales-entry.ts
  - apps/erp/lib/invoice-finalize.ts
updated: 2026-09-16
---

## What this covers

Recording a sale (**sell-a-unit**), taking/tracking payments
(**record-a-part-payment**), and separately, raising the formal paperwork —
a GST invoice or quotation (**raise-a-gst-invoice**).

## Sale vs. invoice — two different moments

A **sale** is real the instant it's recorded — stock decrements, the customer
owes what they owe, immediately (see **business-rules**). An **invoice** is
the formal GST document, generated whenever the owner gets to it, and can
combine multiple sales/line-items into one document. `sales.finalized` tracks
whether this has happened — it's derived from the relationship, never a
separate status a human has to remember to flip.

## Numbering

Invoice numbers continue the DBI series (e.g. `DBI2026-681` for FY 2026-27),
generated only via `generate_po_number`-style atomic RPCs
(`increment_invoice_number`/`next_document_number`) — never a client-side
guess. See **business-rules**.

## Payments are an append-only ledger

`sale_payments` — any role can add an installment; only the owner can delete/
correct one. `sales.amount_paid`/`payment_status` are trigger-derived, never
written directly. See **record-a-part-payment**.

## Rental charges are sales rows too

Rentals add a fourth row-kind discriminator to `sales`: `rental_agreement_id` (plus
`rental_period_start`/`rental_period_end`), alongside `asset_ledger_id`,
`accessory_id` and `repair_job_id`. A rent charge is an ordinary sale — same payment
ledger, same part-payments, same multi-item invoice combining.

Two things distinguish it. A **rent charge** leaves `asset_ledger_id` NULL (it is pure
revenue, and filling it in would make the rented unit read as sold and charge its whole
purchase cost against one month of rent), and it invoices as `item_type = 'rental'`
with **SAC 997313** rather than a goods HSN, because renting goods is a supply of
service. A **rent-to-own buyout** does carry `asset_ledger_id` and is billed as the
ordinary unit sale it is. See **rentals**.

## Related

**sell-a-unit**, **raise-a-gst-invoice**, **record-a-part-payment**,
**finance-gst-reports**, **customers-vendors**.
