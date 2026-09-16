---
slug: manage-vendors
title: Adding, editing, and deleting vendors
kind: process
audience: [owner, manager, employee]
module: customers-vendors
routes: [/dashboard/vendors]
keywords: [vendor, supplier, add vendor, edit vendor, delete vendor, supplies_accessories, accessory vendor, gstin, gst fetch, receive stock, naya vendor, vendor list, spoc]
sources:
  - apps/erp/app/dashboard/vendors/page.tsx
  - apps/erp/components/VendorFormFields.tsx
  - apps/erp/components/AddVendorDialog.tsx
  - apps/erp/app/api/vendors/route.ts
updated: 2026-09-16
---

## What this is

Managing the vendor list — the same `vendors` table used everywhere a
purchase, accessory receipt, or vendor-tagged expense needs one. The full
Vendors page is owner-only, but there's one narrow, deliberate exception: an
employee receiving accessory stock can create a brand-new vendor on the spot
from within that flow.

## Who can do this

- **Full page** (`/dashboard/vendors` — list, view, edit, delete, restore,
  and the `supplies_accessories` tag): owner only. The page is wrapped in
  `RequireOwner`.
- **Creating a new vendor from Receive Stock / expense entry** (not editing
  an existing one): any role that can reach that flow, via
  `POST /api/vendors` — the route allows a caller with `accessories` or
  `new_entry` page access as well as the owner.

## Steps — owner: add a vendor

1. Open **Vendors** (`/dashboard/vendors`) and click **Add Vendor**.
2. Fill in **Company Name*** (required), SPOC Name, Owner Name, Phone, Alt
   Phone, Email, Address Line 1/2, City, State, Pincode.
3. Set **Has GST?** to Yes to reveal **GST Number** — typing 15 characters
   and tabbing out (`onBlur`) auto-calls `/api/gst` and fills
   **Auto-filled Company Name (from GST)** and mirrors it into Company Name;
   if the lookup fails you get an inline error asking you to check the
   number.
4. Add any free-text **Remarks**.
5. Check **Supplies accessories** if employees should be able to pick this
   vendor when receiving accessory stock — this checkbox only appears on the
   owner's form (`showSuppliesAccessories` prop), never on the employee-facing
   create dialog.
6. Click **Save Vendor**.

## Steps — owner: edit, delete, restore a vendor

7. Click the pencil icon on any row to reopen the same form pre-filled,
   including the current `supplies_accessories` state, then **Update
   Vendor**.
8. Click the trash icon to soft-delete — you're prompted for a reason
   (`DeleteRecordDialog`); the row is greyed out and hidden from the default
   list, not removed from the database.
9. Check **Show deleted records** to see soft-deleted vendors and click the
   restore icon to bring one back.
10. Click the eye icon to open a read-only detail view (SPOC, Owner Name,
    phone, alt phone, email, full address, GST, remarks) without entering
    edit mode.

## Steps — employee: create a vendor from Receive Stock

11. On the Accessories page, click **Receive Stock** on the SKU you're
    stocking, then, if the vendor you need isn't in the Vendor dropdown,
    click **+ Add new vendor** — it opens `AddVendorDialog`, the same field
    set as the owner's form (Company Name, SPOC, Owner Name, Phone, Alt
    Phone, Email, Address, GST) **minus** the "Supplies accessories"
    checkbox.
12. Fill in at least **Company Name*** and submit. `POST /api/vendors`:
    - requires only `company_name` from a non-owner caller;
    - first checks (case-insensitive, trimmed) whether a vendor with that
      exact company name already exists — if so, it reuses that vendor
      instead of creating a duplicate (and tags it `supplies_accessories =
      true` if it wasn't already), so a near-duplicate name never spawns a
      second record;
    - otherwise inserts a brand-new vendor with `supplies_accessories`
      **forced to `true`** server-side, regardless of what the form sent —
      an employee can never leave a self-created vendor untagged.
    - No approval gate: the vendor is immediately usable in the same flow
      that opened the dialog, matching this app's "stock-in is immediately
      real" principle.
13. What that employee **cannot** do afterward: edit this vendor's details,
    delete it, or change its `supplies_accessories` tag — all of that stays
    exclusively on the owner-only Vendors page. They can only reuse it (by
    name) or create another new one the same way.

## What `supplies_accessories` actually controls

`GET /api/vendors` scopes the **entire result set**, not just which fields
are visible, for any non-owner caller: it only returns rows where
`supplies_accessories = true`. A laptop-only vendor the owner has never
tagged is invisible to an employee even by name — this is on top of (not
instead of) the field-level redaction (`redactManyForRole`) that strips
GST/contact details for non-owner roles on every vendor row that *is*
returned. See **business-rules** and **customers-vendors** for the full
redaction rationale.

## Common mix-ups

- **"I'm an employee and I can't find the Vendors page in navigation."**
  Correct — there is no owner-only Vendors page link for non-owner roles;
  the only vendor-creation surface available to them is the inline dialog
  inside Receive Stock (or similar accessory-purchase entry points), not a
  standalone list.
- **"I added a vendor from Receive Stock but the owner says it's not tagged
  for accessories."** It always is — `supplies_accessories` is forced `true`
  server-side on this path regardless of the request body, so this
  shouldn't be possible; if a vendor is missing from an employee's dropdown,
  check whether the owner later untagged it from the Vendors page.
- **"Why can't I edit the vendor I just created?"** By design — creation
  from Receive Stock is the one narrow exception to "vendors are owner-only";
  editing, deleting, and tag changes were deliberately not extended to
  non-owner roles.

## Related

**customers-vendors**, **manage-customers** (owner of the customer side of
this pairing), **business-rules** (the vendor-identity redaction default and
this exception), **receive-stock**.
