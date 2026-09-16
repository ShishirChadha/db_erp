---
slug: record-a-vendor-payment
title: Recording a vendor payment against a Purchase Order
kind: process
audience: [owner]
module: purchasing
routes: ['/dashboard/purchase-orders/[id]', '/dashboard/purchase-invoices/[id]']
keywords: [vendor payment, pay vendor, po payment, installment, add vendor payment, balance due, outstanding to vendor, paisa diya, vendor ko payment]
sources:
  - apps/erp/components/AddVendorPaymentDialog.tsx
  - apps/erp/app/api/purchase-orders/[id]/payments/route.ts
  - apps/erp/app/api/purchase-orders/[id]/payments/[paymentId]/route.ts
  - apps/erp/app/dashboard/purchase-orders/[id]/page.tsx
  - apps/erp/app/dashboard/purchase-invoices/[id]/page.tsx
updated: 2026-09-16
---

## What this is

Recording what's actually been paid to a vendor against one Purchase Order —
the debit-side twin of **record-a-part-payment** on the sales side. A PO's
`grand_total` only ever records what's owed; `vendor_payments` is the
append-only ledger of what's actually been paid, and it's what makes the bank
recon flow able to match a debit against a specific PO at all (see
**reconcile-bank-transactions**, step 9 — matching a debit to a PO writes into
this exact same ledger via this exact same route).

This lives on the **Purchase Order detail page** as a "Vendor Payment" panel
(`/dashboard/purchase-orders/[id]`), and the same dialog is mirrored on the
**Purchase Invoice detail page** (`/dashboard/purchase-invoices/[id]`) since an
invoice doesn't have its own separate payment ledger — it just reads and adds
to the same PO's `vendor_payments`, filtered by that PO's id.

## Who can do this

Owner only, in practice. Both pages this dialog is mounted on are wrapped in
`RequireOwner`, and the routes that actually change data enforce it too:
`POST` (record a payment) and `DELETE` (remove one) both require `isOwner()`.
This is stricter than `sale_payments` on the sales side, where any signed-in
role can log an installment — Purchase Orders stays owner territory throughout
(vendor identity and cost are owner-only everywhere else on a PO, and this
follows the same posture). The `GET` (list installments) only requires
manager-or-above, but there's currently no page a manager can reach that
surfaces it, since both mounting pages gate the whole page to owner.

## Steps

1. Open the PO from **Purchase Orders** (or its linked Purchase Invoice from
   **Purchase Invoices**).
2. Find the **Vendor Payment** panel — it shows the current `payment_status`
   and "₹X of ₹Y" paid so far. An **Add Payment** button appears whenever the
   PO isn't already fully paid.
3. Click it. The dialog pre-fills **Amount Paid** with the remaining balance
   due (`grand_total − amount_paid`) — edit it if this installment is for a
   different amount.
4. Fill in **Paid From** (Digitalbluez / Techtenth / Cash), **Date Paid**
   (defaults to today), and optionally **Method** (e.g. NEFT/UPI/Cheque),
   **Reference** (UTR/cheque no.), and a **Note**.
5. Submit. This inserts a new `vendor_payments` row. `purchase_orders.
   amount_paid`/`payment_status` update automatically via a trigger — never
   write those fields directly from anywhere.
6. **Overpayment guard**: if this amount would push total paid more than ₹0.50
   over the PO's `grand_total`, the server refuses with `error_code:
   'exceeds_po_total'` instead of silently accepting it. The dialog shows the
   error as a confirm dialog — accepting it resubmits with
   `confirm_overpayment: true`, which the route then honors (a real overpayment
   does happen, e.g. a vendor discount applied after the PO was raised).

## Correcting a mistaken entry

Only the owner can remove a payment entry (`DELETE /api/purchase-orders/[id]/
payments/[paymentId]`, via the **Remove** link next to each row in the panel).
There's no edit-in-place — a wrong entry is deleted and a correct one added
back, the same posture as `sale_payments`. Deleting recomputes `amount_paid`/
`payment_status` via the same trigger.

## Common mix-ups

- **"I don't see an Add Payment button."** It's hidden once `payment_status`
  is `paid` — there's nothing further to record. Check the panel's own
  "X of Y" line to confirm the PO is actually fully paid before looking
  elsewhere.
- **"A payment I didn't enter here just appeared."** Bank Reconciliation can
  create one of these automatically when a bank debit is matched against this
  PO's outstanding balance (see **reconcile-bank-transactions**) — it's the
  identical route and ledger, just triggered from the bank-matching flow
  instead of this dialog, and it's auto-noted "Auto-recorded from bank recon:
  …" so you can tell the two apart.
- **"The Purchase Invoice page shows the same payments as the PO."** That's by
  design — an invoice's payment history is its linked PO's `vendor_payments`,
  not a separate per-invoice ledger.

## Related

**record-a-part-payment** (the parallel mechanic on the sales side),
**reconcile-bank-transactions** (the other way a `vendor_payments` row gets
created), **purchasing**, **business-rules**.
