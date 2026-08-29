---
slug: raise-a-gst-invoice
title: Raising a GST invoice
kind: process
audience: [owner, manager]
routes: [/dashboard/invoices/new, /dashboard/invoices]
keywords: [invoice, gst invoice, raise invoice, generate invoice, billing, tax invoice, DBI number]
sources:
  - apps/erp/app/api/invoices/**
  - apps/erp/lib/invoice-finalize.ts
updated: 2026-08-29
---

## What this is

Turning one or more already-recorded sales into a formal, numbered GST
invoice. Separate from the sale itself — a sale is real the moment it's
entered; the invoice is deferred paperwork the owner does whenever they get
to it. Can combine multiple sale line items into a single invoice document.

## Steps

1. Open **Invoices → New** (`/dashboard/invoices/new`).
2. Select the sale(s) to include (unfinalized sales for the relevant
   customer/entity show up here).
3. Confirm the line items, GST breakdown, and which entity (Digitalbluez /
   Techtenth) the invoice is under — this determines GST treatment (home
   state UP-09 for Digitalbluez; see **finance-gst-reports**).
4. Generate. The invoice number is minted via the atomic numbering RPC (DBI
   series, continuing from wherever the FY series left off) — never a manual
   guess. This also flips the linked sale(s) `finalized`.

## Related

**sales-invoicing**, **finance-gst-reports**, **business-rules** (numbering
rule).
