---
slug: record-a-part-payment
title: Recording a part payment / installment
kind: process
audience: [owner, manager, employee]
routes: [/dashboard/sales]
keywords: [payment, installment, part payment, add payment, balance, outstanding, paisa liya, collect payment]
sources:
  - apps/erp/app/api/sales/[id]/payments/route.ts
  - apps/erp/app/api/sales/[id]/payments/[paymentId]/route.ts
  - apps/erp/components/AddPaymentDialog.tsx
updated: 2026-08-29
---

## What this is

Recording money received against a sale that wasn't paid in full up front.
Any role can do this — an employee taking a customer's 2nd or 3rd installment
logs it themselves, immediately real, same principle as the sale itself.

## Steps

1. Open the sale from the **Sales Ledger** (or the Live Stock Sold tab).
2. Click **Add Payment**.
3. Enter the amount and an optional note (e.g. "2nd installment").
4. Submit. This inserts a `sale_payments` row. `sales.amount_paid` and
   `payment_status` update automatically via a trigger — never edit those
   fields directly from anywhere.

## Correcting a mistaken entry

Only the owner can delete or correct a payment
(`DELETE /api/sales/[id]/payments/[paymentId]`) or change which payment
account it was recorded against. This is deliberate — the ledger is
append-only for everyone else, so a wrong entry needs an explicit owner
correction rather than being silently edited.

## Related

**sales-invoicing**, **business-rules**.
