---
slug: log-and-edit-an-expense
title: Logging, editing, and soft-deleting an expense
kind: process
audience: [owner, manager, employee]
module: expenses
routes: [/dashboard/expenses]
keywords: [expense, add expense, log expense, edit expense, delete expense, electricity, rent, transport, food, porter, freight, shipping, receipt, attachment, paid by staff, out of pocket, paid from, vendor, kharcha, bill entry, naya kharcha]
sources:
  - apps/erp/components/AddExpenseDialog.tsx
  - apps/erp/components/EditExpenseDialog.tsx
  - apps/erp/components/ExpenseAttachmentsField.tsx
  - apps/erp/lib/expense-type-rules.ts
  - apps/erp/app/dashboard/expenses/page.tsx
updated: 2026-09-16
---

## What this is

Recording a one-off cost that isn't a purchase or a sale — electricity, rent,
transport, food, porter/freight, shipping, bank charges, salaries, or any
other custom type — and editing or soft-deleting it afterward. For the
deeper data-model and owner-only-type mechanics, see the **expenses** module
overview; this chapter is the click-by-click version.

## Who can do this

Any role granted the `expenses` page edit grant (`canEditPage("expenses")`
or owner) — the Add Expense button, Bulk Add, Edit, and Delete actions on the
Expenses page only render for those sessions (`canEdit` in
`app/dashboard/expenses/page.tsx`). The category dropdown itself is
open-ended: anyone with edit access can type a brand-new type inline with no
owner approval, except the handful of types the owner has marked owner-only
(Salaries, Bank Charges, GST Payment by default), which never appear in the
Type selector for a non-owner at all.

## Steps — add an expense

1. Open **Expenses** (`/dashboard/expenses`) and click **Add Expense**.
2. Enter **Expense Date*** (required).
3. Pick **Type** from the searchable dropdown, or type a new value and
   commit it to add it to the list on the fly (`onOtherCommit`) — this
   writes a new `custom_options` row under `expense_types` immediately, no
   approval step.
4. Which optional fields appear next depends entirely on what you picked for
   Type, and on whether you fill in **Paid By Staff**:
   - **From / To** only show up for a shipping/porter-shaped type — the
     rule matches the keywords "porter", "freight", or "shipping" anywhere
     in the type text (`isLocationRelevantType`), so a type like "Freight
     Charges" still triggers it. The broader "Transport" type deliberately
     does **not** show these fields.
   - **Vendor** shows for every type except the three the owner has marked
     as clearly vendor-less by default — `salaries`, `bank charges`, `gst
     payment` (case-insensitive) — and only ever renders at all for an
     **owner** session; non-owner sessions never see the Vendor field or
     fetch the vendor list, matching this app's default vendor-identity
     redaction.
   - **Paid From** (the company account — Digitalbluez / Techtenth / Cash)
     is visible only while **Paid By Staff** is empty. The moment you pick a
     staff name there, Paid From disappears and is replaced with a note
     that the account gets decided later, at settlement — see
     **settle-staff-reimbursements**.
5. If Vendor is showing and the vendor you need isn't listed, click **+
   New** next to the Vendor dropdown to open the same `AddVendorDialog` used
   elsewhere in the app (owner-only here), fill in at least Company Name,
   and save — it's immediately selected on the expense you're building.
6. Enter **Amount** and a free-text **Description** (this is the only
   free-text field the form collects — the older `remarks` column still
   exists in the schema but isn't shown here).
7. Optionally attach one or more receipts under **Receipts / Attachments**
   (see Attachments below).
8. Click **Add Expense**. This submits `POST /api/expenses` with whichever
   From/To, Vendor, and Paid From values are currently relevant — any of
   those fields hidden by the rules above is sent as empty/blank rather
   than a stale leftover value from before you changed Type or Paid By
   Staff.

## Steps — edit an expense

9. Click **Edit** on any row (same access as Add). The dialog pre-fills
   from the existing row and applies the exact same From/To, Vendor, and
   Paid From visibility rules live as you change Type or Paid By Staff.
10. One difference from Add: if you change Type to something that no longer
    shows From/To or Vendor, saving clears those fields — but **Paid From is
    left untouched** when hidden by an existing `paid_by_staff` value, since
    it may already carry the entity a reimbursement settled it against;
    editing never wipes that out just because the field isn't shown.
11. Click **Save Changes** (`PATCH /api/expenses/[id]`).

## Steps — soft-delete / restore

12. Click **Delete** on a row — you're prompted for a reason
    (`DeleteRecordDialog`), stored and shown in the **Deleted Remarks**
    column. This is a soft delete (`is_deleted: true` via `PATCH
    /api/expenses/[id]`), not a hard delete.
13. Check **Show deleted records** to see soft-deleted rows, then click
    **Restore** to bring one back (clears `is_deleted`).

## Attachments

Uploading a receipt (`ExpenseAttachmentsField`, shared by both dialogs) is a
two-step signed-URL flow: click **Attach file**, the browser gets a signed
upload URL from `/api/storage/upload-url` (bucket `expense-receipts`,
private), uploads directly to it, then the resulting `{key, name, size}` is
appended to the form's in-memory attachment list. **Nothing is saved to the
expense row until you submit the dialog** — on Add, there's no expense id
yet to attach to independently. Click **View** to open a receipt via a
short-lived signed download URL, or **Remove** to drop it from the list
(this also fires `DELETE /api/storage/delete` for that file). Attachments
are **not** owner-gated — any role with the `expenses` edit grant can
attach or view one, unlike Vendor.

## Common mix-ups

- **"I picked Salaries as the type and now the whole row disappeared from
  the list."** If you're not the owner, this is expected — `Salaries` (and
  Bank Charges, GST Payment) are owner-only types; a non-owner session never
  sees a row whose type matches one, and can't create one either (a `POST`/
  `PATCH` attempting to set an owner-only type is rejected).
- **"Why did Paid From vanish when I picked a staff name?"** By design — see
  step 4. The company account that ultimately reimburses the staff member
  isn't known yet at entry time; it's captured later in **Staff
  Reimbursements** at settlement.
- **"I can't see or set a Vendor on this expense."** Vendor is owner-only in
  the UI for expenses (unlike the one narrow accessory-purchase exception
  elsewhere in the app) — a non-owner session never gets the field or the
  vendor list, and the API strips any joined vendor name from its response
  too.
- **"My new expense type isn't showing up for other staff."** It should —
  `custom_options` writes are immediately real and shared across all
  sessions, unless it was created (or later marked) owner-only, in which
  case only owner sessions ever see it.

## Related

**expenses** (module overview — data model, owner-only types, reporting),
**settle-staff-reimbursements**, **set-up-a-recurring-expense**,
**business-rules** (vendor-identity redaction default).
