---
slug: take-a-trade-in
title: Taking a customer's old laptop in part-payment (trade-in / upgrade)
kind: process
audience: [owner, manager, employee]
module: sales-invoicing
routes: [/dashboard/sales, /dashboard/entry/sell, /dashboard/trade-ins]
keywords: [trade-in, trade in, upgrade, exchange, buyback, buy back, purana laptop, purana le liya, deduct, delta, difference, part exchange, old laptop, buyback slip]
sources:
  - apps/erp/lib/trade-ins.ts
  - apps/erp/app/api/trade-ins/**
  - apps/erp/components/TradeInDialog.tsx
  - apps/erp/app/dashboard/trade-ins/**
  - apps/erp/lib/assistant/trade-in.ts
  - supabase/migrations/20261123_trade_ins.sql
updated: 2026-11-23
---

## What this is

A customer upgrades: they give us the laptop they have and buy a better one,
paying only the difference. In the ERP that is **two deals**, recorded
together:

1. We **buy** the old laptop back, at a value we decide (usually less than
   they paid, because they've used it).
2. We **sell** the new laptop at its **full** price.

The trade-in value is recorded on the new sale as a payment from the
non-cash account **"Trade-in"**; the customer pays the rest as usual.

Example (the 2026-11-23 case that started this): HP EliteBook 830 G7 sold in
May for ₹34,000 (Digitalbluez, GST). In November the customer upgrades to a
ThinkPad P14s at ₹56,000 (Techtenth). We take the HP back for ₹26,000; the
customer pays ₹30,000 into Techtenth. The May sale stays exactly as it was.

## Trade-in vs replacement vs return

| Situation | Use | Old sale | Customer pays |
|---|---|---|---|
| Faulty unit swapped under warranty | **Replacement Job** (open-a-replacement-job) | Cancelled; what they paid carries over | Nothing, or the difference for a better model |
| Upgrade: they used it, want better | **Trade-in** (this chapter) | **Stays** | New price minus trade-in value |
| They want their money back | **Return** (return-to-vendor-rma) | Cancelled | Refund or credit note |

The replacement flow can't express an upgrade with a deduction: it always
carries the old sale's full paid amount forward, and cancels a sale that may
already be GST-filed.

## Who can do this

- **Taking** a trade-in: anyone who can sell or record a payment (Live Stock,
  New Entry or Sales page access) — the person at the counter agreeing the
  value enters it, immediately real, like the sale itself.
- **The Trade-ins list** (`/dashboard/trade-ins`) shows what we paid for each
  laptop (a purchase cost), so it is its own page grant ("Trade-ins list" in
  Settings → Users), off for staff by default. Whoever took a trade-in can
  always open its buyback slip.
- **Undo** is owner-only.
- DB can do it too, with the **Trade-ins (upgrades)** skill (see **assistant**).

## Steps

1. Record the new sale as usual (Sell form, or DB) at the new laptop's
   **full** price, with whatever money the customer pays on top.
2. Open the trade-in:
   - right after saving on the Sell form: **Customer gave an old laptop? Add
     trade-in** (shown when the cart had one laptop), or
   - later: Sales Ledger → open the sale → **Trade-in** row → **Add trade-in**.
3. Type the old laptop's **serial** and press **Check**:
   - **Ours** (we sold it before): shows when, to whom and for how much. It
     comes back on its existing stock record.
   - **New to us**: pick its model from the catalogue (add it in SKU Master
     first if it's missing). A new stock record is created.
   - **Blocked**: the serial is already in our stock, rented, or on two records.
4. Enter the **trade-in value**, date, condition, what came with it (charger,
   bag), and the customer's ID type with only its **last 4 characters**
   (never the full Aadhaar/PAN number).
5. Save, then **Print buyback slip**: two copies, the customer signs one for
   our file. It carries their declaration that the laptop is theirs to sell.

If the trade-in plus what's already paid would exceed the sale total, you're
asked to confirm (it is almost always a typo).

## What it does, exactly

- **The old laptop** goes to **QC pending**, stock +1. Its cost for its next
  sale is the trade-in value (`asset_ledger.trade_in_value`). Its original
  purchase cost (`cost_price`) is untouched, so a PO attached later for the
  first purchase still lands correctly.
- **Profit**: the profit report (`v_report_sale_lines`) picks a unit's cost
  per "life": a sale made after a trade-in costs the trade-in value; the sale
  before it keeps the original cost. Stock value uses the trade-in value too.
- **The new sale** gets a `sale_payments` row of the value on account
  **Trade-in**. Bank reconciliation never matches it, because it only looks
  at Digitalbluez/Techtenth/Cash.
- **The entity buying it back** is always the new sale's own entity.
- A laptop **new to us** is kept out of **Needs PO Attached** and the
  attach-to-PO flows, since no vendor PO will ever exist for it.

## Undoing a trade-in

Owner, Trade-ins page → **Undo** (with a reason). It works only while the
laptop is still with us and hasn't been sold again; void that later sale
first if it has. Undo removes the Trade-in payment from the sale, and either
puts the unit back to **sold** (if it was ours) or takes it out of stock (if
it was new to us).

A Trade-in payment can't be edited or deleted on its own, and a sale with a
trade-in can't be voided until the trade-in is undone — the payment, the
stock and the record always move together.

## Common mix-ups

- **"The sale's profit looks huge."** Part of the price was paid in a used
  laptop; that value turns into real money only when the old laptop is sold
  again, and its profit then counts from the trade-in value.
- **"Can I record the trade-in on a replacement job?"** No. If the customer
  is upgrading and we're buying the old one for less, it's a trade-in.
- **"The old laptop shows its first purchase PO."** The PO number stays (it
  is how the unit was first bought); its cost and source now show
  "Customer trade-in".

## Related

**sell-a-unit**, **open-a-replacement-job**, **record-a-part-payment**,
**qc-a-unit**, **assistant**.
