---
slug: manage-customers
title: Adding, editing, and bulk-importing customers
kind: process
audience: [owner, manager, employee]
module: customers-vendors
routes: [/dashboard/customers]
keywords: [customer, add customer, billing address, shipping address, ship to, contact persons, pan, gst treatment, place of supply, mobile mandatory, edit customer, delete customer, restore customer, bulk add, csv import, gstin, gst fetch, duplicate customer, phone number, customer type, business, individual, naya customer, customer tier, vip, wholesale]
sources:
  - apps/erp/app/dashboard/customers/page.tsx
  - apps/erp/components/AddCustomerDialog.tsx
  - apps/erp/components/EditCustomerDialog.tsx
  - apps/erp/components/CustomerForm.tsx
  - apps/erp/components/CustomerDetailDialog.tsx
  - apps/erp/components/BulkAddDialog.tsx
  - apps/erp/app/api/customers/[id]/tier/route.ts
updated: 2026-11-13
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

The form follows Zoho Books' "New Customer" layout. It is one component
(`CustomerForm`) behind both **Add Customer** and **Edit**, and the same
dialog opens from the Customers page and from every sell-side flow (Sell,
Service, Quotation/Proforma, Customer Detail → Change Customer). Its layout
follows the dialog's own width (container queries), so on a phone the label
column stacks above each field and the tab strip becomes a dropdown — nothing
scrolls sideways.

1. Open **Customers** (`/dashboard/customers`), or any sell screen, and click
   **Add Customer**.
2. Top block: **Customer Type** (Business / Individual), **Primary Contact**
   (salutation + first + last name), **Company Name** (Business only),
   **Display Name\*** (stored as `customer_name`; the dropdown suggests
   combinations of the name/company, free text allowed), **Email**,
   **Phone** — Work Phone and **Mobile\*** (stored as `phone`; saved as the
   bare 10 digits, so "+91 98765 43210" and "09876543210" both become
   `9876543210`), and **Communication Channels** (Email/SMS/WhatsApp).
   Switching to Individual clears Company, GSTIN and Contact Persons.
3. **Other Details** tab: **GST Treatment\*** (Registered – Regular,
   Registered – Composition, Unregistered Business, Consumer, Overseas;
   written to `gst_treatment`, which GSTR-1 routing reads), **GSTIN** (shown
   and required only for the two Registered treatments; **Prefill** calls
   `/api/gst` and fills company name, billing Street 1 and state), **Place of
   Supply\*** (= `state_code`/`state`; set automatically from the GSTIN's
   first two digits, or from the billing PIN when there's no GSTIN, and still
   overridable), **PAN** (auto-filled from GSTIN characters 3–12), plus our
   own Email 2, Source, Social Following and Google Review.
4. **Address** tab: **Billing Address** — Attention, **Street 1\***, Street
   2, **City\***, **Pin Code\*** (not required for Overseas), State — and
   **Shipping Address** with the same fields plus a delivery phone and a
   **Copy billing address** link. Billing is the long-standing
   `address_line1/2`, `city`, `state`, `pincode` columns (and the composed
   flat `address`); shipping is `shipping_*` plus the composed
   `shipping_address`. Leave shipping blank to ship to the billing address.
5. **Contact Persons** tab (Business only): any number of extra contacts
   (salutation, name, email, work phone, mobile), stored in
   `contact_persons` (jsonb). The first one's name is also written to the
   legacy `contact_person` text column that Sales/Stock listings read.
6. **Remarks** tab: internal-only notes.
7. Click **Save**. If a required field sits on a tab you're not looking at,
   the form switches to that tab and marks the field. Then the duplicate
   check runs:
   - If a non-deleted customer already has this exact **mobile number**, the
     save is **blocked** with an inline error naming the existing customer —
     you're expected to use that customer record instead of creating a new
     one.
   - If a customer with the same **name** already exists but a different
     mobile number, you get a non-blocking warning and can still save — this
     creates a second, separate customer.
   - A race where two staff save the same new number at the same moment is
     caught server-side too (the `customers_active_phone_unique` index),
     surfacing the same blocking message.

Required fields are enforced by the form only — the table columns stay
nullable because the storefront signup and lead → customer conversion also
insert customers. An older customer missing a now-required field (no mobile,
no billing address) has to have it filled in the next time someone edits
them.

## How the addresses reach documents

Every document keeps its own **snapshot** of Bill To and Ship To, copied from
the customer when the document is created (or its customer is changed). A
later edit to the customer never rewrites a document already issued.

- **Invoices** generated from sales (Sales Ledger, finalize-batch, repair
  jobs, rentals — all via `lib/invoice-finalize.ts`) copy `address` →
  `customer_address` and `shipping_address` → `shipping_address`. The manual
  invoice form prefills **Ship To** from the customer, still editable.
  Credit notes copy both from the original invoice.
- **Quotations and Proforma Invoices** show Bill To read-only and an
  editable **Ship To** prefilled from the customer, saved to
  `sales_documents.shipping_address`. Their PDF prints Bill To and Ship To
  side by side.
- Both PDFs fall back to the billing address when Ship To is blank.

## Steps — edit or delete a customer

6. Click **Edit** on any row to open the same form pre-filled. A customer
   created before the structured address fields existed (only the old flat
   `address` column has data) has that value shown in billing Street 1
   rather than a blank form, so it isn't silently dropped on next save.
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
    `address` (billing), `shipping_address`, `pan`, `work_phone`, `phone`,
    `email`, `source`, `google_review` (`true`/`TRUE`/boolean),
    `social_following`. `gst_treatment` is set to Registered – Regular when
    the row has a GSTIN, else Consumer. Every imported row is inserted as
    `is_deleted: false`.
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
