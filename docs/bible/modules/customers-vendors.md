---
slug: customers-vendors
title: Customers & Vendors
kind: module
audience: [owner, manager, employee]
routes: [/dashboard/customers, /dashboard/vendors]
keywords: [customer, vendor, contact, tier, supplier, add customer, add vendor, gstin]
sources:
  - apps/erp/app/api/customers/**
  - apps/erp/app/api/vendors/**
updated: 2026-08-29
---

## Customers

Visible to any signed-in staff (page key `customers`). Customer tiers exist
for pricing/loyalty purposes; a customer cannot self-change their own tier
(`prevent_self_tier_change()` guards this on the website-facing side too, per
`customer_profiles`).

## Vendors — owner-only, with one employee exception

Vendors are owner-only to view/edit/tag, **except**: an employee receiving
accessory stock can create a *new* vendor from that flow
(`POST /api/vendors`, full fields, resolved-by-name against existing vendors to
avoid duplicates) — always forced `supplies_accessories = true` server-side,
immediately real, no approval gate. They still cannot edit, delete, or
tag/untag an *existing* vendor.

`vendors.supplies_accessories` also gates what `GET /api/vendors` even returns
to a non-owner — a laptop-only vendor is never exposed to an employee, not
even by name. See **business-rules**.

## Related

**business-rules**, **accessories** (the vendor-creation exception),
**purchasing**.
