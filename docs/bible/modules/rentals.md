---
slug: rentals
title: Laptop Rentals
kind: module
audience: [owner, manager, employee]
routes: ['/dashboard/rentals', '/dashboard/rentals/[id]']
keywords: [rental, rent, renting, kiraya, kiraye pe dena, lease, on rent, rent out, laptop rent, security deposit, deposit, buyout, rent to own, overdue return, rent invoice, monthly rent]
sources:
  - apps/erp/app/api/rentals/**
  - apps/erp/app/dashboard/rentals/**
  - apps/erp/lib/rentals.ts
  - apps/erp/components/NewRentalDialog.tsx
  - apps/erp/components/RentalActionDialogs.tsx
updated: 2026-09-16
---

## What this covers

Renting laptops (or any serialized unit) out to a customer for a period, billing the
rent, holding a security deposit, taking the unit back, and handling a renter who
decides to buy the unit instead.

## Rental units come from ordinary sellable stock — there is no rental fleet

A rented unit is an ordinary `asset_ledger` row that temporarily has
`status = 'on_rent'`. There is no separate fleet table and no "rental" SKU category.
A unit goes out, comes back, and is sellable again.

While a unit is `on_rent` it is out of `SELLABLE_STATUSES`, which is what
automatically removes it from the Sell screen's picker, from the cart validator, and
from the website's `reserve_order_items` reservation — none of those needed changing.
It stays visible on Stock / Live Stock under an "On Rent" filter, so it is never
invisible, just not sellable.

## The rent charge IS a sales row — there is no separate rental ledger

`sales` rows are already discriminated by which FK is set (`asset_ledger_id` for a
unit, `accessory_id` for a fungible item, `repair_job_id` for repair labour). Rentals
add a fourth: `rental_agreement_id`, plus `rental_period_start`/`rental_period_end`.

This is the same thing repair jobs do, and it is why rent needs no new financial
plumbing at all: `sale_payments`, the `sync_sale_payment_totals` trigger, part
payments, `createInvoiceFromSales`, combining into a multi-item invoice via
`finalize-batch`, and receivables reporting all work on a rent charge unchanged.

**A rent charge carries `rental_agreement_id` and leaves `asset_ledger_id` NULL.**
That is deliberate and load-bearing. If a rent charge carried the unit's id, the
rented laptop would show as *sold* on the Sold Stock tabs, and the reporting view
would charge its entire purchase cost as COGS against one month of rent. The unit
link lives on `rental_agreement_items` instead.

A **buyout** is the exact opposite and does carry `asset_ledger_id`, because it is a
genuine unit sale that should keep real COGS.

## Stock arithmetic across the whole lifecycle

| Event | asset_ledger | stock_movements |
|---|---|---|
| Handover | sellable → `on_rent` | `adjustment` −1 |
| Return | `on_rent` → `qc_pending` | `adjustment` +1 |
| Buyout | `on_rent` → `sold` | **nothing** |
| Lost / damaged | `on_rent` → `scrapped` | **nothing** |

Rent-then-return nets to zero. Rent-then-buyout nets to −1, identical to an ordinary
sale — the unit simply never came back, so the handover's decrement *is* the sale's
decrement. This is why the buyout route does not go through `processSingleSaleItem`:
that helper writes its own `'sale'` movement and would decrement a second time.

## A returned unit goes back through QC, not straight to the shelf

Returns land in `qc_pending` with `qc_status = 'pending'`, never `ready_for_sale`. A
laptop that has been on someone's desk for months is re-checked before it is sold or
rented again.

## Billing is per-agreement, and a person always presses the button

`billing_interval` is `monthly`, `quarterly`, or `one_time` per agreement. The
`scan_rental_cycles()` pg_cron job (daily) raises an **activity task** plus an in-app
notification when a cycle is due or a return is overdue — it never creates the `sales`
row itself. Money rows stay human-initiated, the same call the recurring-expense
scanner makes. Billing the same period twice is refused.

If a customer returns some units mid-term, the next cycle is scaled down to the units
still out rather than charging the full agreement rent.

## GST on rent

Renting goods is a supply of **service** under GST, so a rental invoice line carries
**SAC 997313**, not a goods HSN. GST applies exactly when the agreement's
`payment_account` resolves to a GST-registered entity (Digitalbluez today) via
`resolveEntityKey()` / `business_profiles.is_gst_registered` — never hardcoded to an
account name. Cash and Techtenth rentals are untaxed even if a GST % is set.

## The security deposit is a liability, not revenue

`security_deposit_amount` lives on the agreement and **never becomes a sales row**
while it is held — a deposit must not inflate revenue or attract GST. `report_rentals`
reports `deposits_held` separately from every rent figure.

Settling a deposit is **owner-only** (money leaving the business). Anything *withheld*
at settlement is genuinely income at that moment, so the settle action offers to record
the forfeited amount as a rental charge, which is what puts it into the Sales Ledger
and the GST return.

## Overdue is derived, never stored

An agreement is overdue when its `expected_return_date` has passed and at least one
unit is still `on_rent`. That is computed wherever it is needed and is not a status
value. `overdue_notified_at` / `billing_notified_at` are cron dedup markers only.

## Who can do what

Opening a rental, adding a unit, recording a return, generating a rent charge, a
buyout and closing an agreement all need the `rentals` page-edit grant — the same
"operational work is not owner-only" line repair jobs draw. Settling a deposit is
owner-only. Generating the GST invoice is owner-only through the existing sales
finalize routes. No cost, vendor or margin field is selected anywhere in this module.

## Not covered yet

Renting fungible accessories (they have no per-unit row), auto-generating the rent
charge without a human, customer-facing rental agreement PDFs, automatic late fees
(the overdue task is raised; the fee is entered by hand), and rentals on the website.

## Related

**sales-invoicing** (a rent charge is an ordinary sale and invoices through the same
flow), **live-stock-qc** (the `on_rent` status and the return-to-QC path),
**inventory-sku** (why rental units are not a separate catalogue),
**activities-notifications** (the billing/overdue reminder tasks),
**finance-gst-reports** (rental income is separable via `line_kind='rental'`),
**business-rules** (immediately-real entries, derived flags, atomic numbering),
**customers-vendors** (the renter is an ordinary customer record).
