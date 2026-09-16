---
slug: manage-customers
title: Adding, editing, and bulk-importing customers
kind: process
audience: [owner, manager, employee]
module: customers-vendors
routes: [/dashboard/customers]
keywords: [customer, add customer, edit customer, delete customer, restore customer, bulk add, csv import, gstin, gst fetch, duplicate customer, phone number, customer type, business, individual, naya customer, customer tier, vip, wholesale]
sources:
  - apps/erp/app/dashboard/customers/page.tsx
  - apps/erp/components/AddCustomerDialog.tsx
  - apps/erp/components/EditCustomerDialog.tsx
  - apps/erp/components/BulkAddDialog.tsx
  - apps/erp/app/api/customers/[id]/tier/route.ts
updated: 2026-09-16
---

## What this is

Creating, editing, soft-deleting/restoring a customer record, and bulk-loading
many customers at once from a CSV. Customers are shared across the whole
app — sales, quotations, invoices, and repair jobs all pick from this same
list (`SearchableCustomerSelect`).

## Who can do this

Any signed-in staff member with access to the **Customers** page (page key
`customers`) — the page is wrapped in `RequirePageAccess`, not `RequireOwner`,
and there's no separate edit-grant check inside it: whoever can open the page
can add, edit, delete, and restore. There is no owner-approval step.

## Steps — add a customer

1. Open **Customers** (`/dashboard/customers`) and click **Add Customer**.
2. Enter **Customer Name** (required) and pick **Type** — Business or
   Individual. Switching to Individual clears Contact Person and the GST
   fields if they were set, since they don't apply.
3. For a Business customer, optionally check **Has GST** and enter the
   **GST Number**, then click **Fetch** — this calls `/api/gst` and
   auto-fills the legal company name, Address Line 1, and the state/state
   code (the state code is what the GST engine needs later to decide
   IGST vs CGST/SGST on an invoice). The lookup only returns one flat
   address string, so it lands in Address Line 1 as a starting point —
   still fully editable.
4. Fill in Address Line 1/2, City, Pincode, Phone, Email, and the optional
   Email 2, Source, Google Review checkbox, and Social Following.
5. Click **Add Customer**. Before inserting, the form checks for a duplicate:
   - If a non-deleted customer already has this exact **phone number**, the
     save is **blocked** with an inline error naming the existing customer —
     you're expected to use that customer record instead of creating a new
     one.
   - If a customer with the same **name** already exists but a different
     phone number, you get a non-blocking warning and can still save — this
     creates a second, separate customer.
   - A race where two staff save the same new phone number at the same
     moment is caught server-side too (the `customers_active_phone_unique`
     index), surfacing the same blocking message.

## Steps — edit or delete a customer

6. Click **Edit** on any row to open the same form pre-filled. A customer
   created before the structured address fields existed (only the old flat
   `address` column has data) has that value shown in Address Line 1 rather
   than a blank form, so it isn't silently dropped on next save.
7. Click **Delete** to soft-delete — you're prompted for a reason
   (`DeleteRecordDialog`), which is stored in **Deleted Remarks** and shown
   in the list when **Show deleted records** is checked. The row isn't
   removed from the database; it just no longer appears in the default view
   or in `SearchableCustomerSelect` pickers elsewhere.
8. Check **Show deleted records** to see soft-deleted customers, then click
   **Restore** on a row to bring it back (clears `is_deleted`,
   `deleted_remarks`, `deleted_at`).

## Steps — bulk-add customers via CSV

9. Click **Bulk Add** next to Add Customer.
10. Choose a CSV file with a header row. The importer (`BulkAddDialog`, a
    shared component also used on the Expenses page) parses it client-side
    with PapaParse and maps each row to: `customer_name`, `type`,
    `contact_person`, `has_gst` (accepts `true`/`TRUE`/boolean), `gst_number`,
    `address`, `phone`, `email`, `source`, `google_review`
    (`true`/`TRUE`/boolean), `social_following`. Every imported row is
    inserted as `is_deleted: false`.
11. Click **Upload**. This is a single client-side `insert()` of every parsed
    row — **there is no duplicate-phone check on this path** (unlike the
    single Add Customer form), so a CSV containing a phone number that
    already exists in the table will only fail if it collides with the
    `customers_active_phone_unique` index, and a batch failure aborts the
    whole insert rather than reporting per-row.

## Common mix-ups

- **"It says a customer with this phone already exists but I don't see them
  in the list."** They may be soft-deleted — check **Show deleted records**,
  or search by phone in Global Search with that box ticked.
- **"The customer tier (VIP/Wholesale) isn't anywhere on this page."** Website
  customer tiers (`standard`/`vip`/`wholesale`, on `customer_profiles`) are
  set via an owner-only API route (`PATCH /api/customers/[id]/tier`) that
  exists in the codebase but is **not wired to any button on the Customers
  page or elsewhere in the ERP UI** as of this writing — there is currently
  no click-through way to change a customer's tier. This affects the online
  storefront's pricing tier, not the in-store Customers list.
- **"Bulk Add silently didn't add some rows."** The CSV insert is all-or-
  nothing — if any row in the batch violates a constraint (most commonly a
  duplicate phone), the whole upload fails and none of the rows are added;
  fix the offending row and re-upload the file.

## Related

**customers-vendors**, **manage-vendors** (the same bulk-add component in a
different context), **business-rules**.
