---
slug: manage-business-profiles
title: Managing business profiles (Digitalbluez / Techtenth / Cash)
kind: process
module: settings-admin
audience: [owner]
routes: [/dashboard/settings]
keywords: [business profiles, entities, digitalbluez, techtenth, cash, gst registered, gstin, invoice prefix, bank details, invoicing mode, external invoicing, zoho, set invoice counter, cutover, invoice numbering migration, entity settings]
sources:
  - apps/erp/components/BusinessProfileManager.tsx
  - apps/erp/app/api/business-profiles/route.ts
  - apps/erp/app/api/business-profiles/[key]/route.ts
  - apps/erp/app/api/business-profiles/[key]/set-invoice-counter/route.ts
updated: 2026-09-16
---

## What this is

Settings → Business Profiles (`BusinessProfileManager`) configures the three
fixed business entities this business sells under: **Digitalbluez**,
**Techtenth**, and **Cash**. Each entity has its own invoice branding, GST
registration status, bank details, and invoice numbering series — this is
the entity model referenced throughout `finance-gst-reports` and
`raise-a-gst-invoice`.

There is no create/delete here — the three entities are fixed by the
`business_profiles` table's own CHECK constraint on `key`
(`digitalbluez`/`techtenth`/`cash`); this screen is purely editing the three
seeded rows.

## Who can do this

Owner only. `GET`/`PATCH /api/business-profiles[/key]` and
`POST /api/business-profiles/[key]/set-invoice-counter` all check
`isOwner(sessionUser)` and return 403 otherwise — these rows carry GSTIN and
bank account details, so this is treated the same as any other
financially-sensitive owner-only screen.

## Steps — editing an entity's core details

1. Open **Settings → Business Profiles**. Each entity is its own card.
2. **GST Registered** checkbox — see "What GST-registered actually changes"
   below.
3. **Legal Name**, **Invoice Prefix** (auto-uppercased), **Address**,
   **State**, **State Code** (2-char, used for GST place-of-supply logic),
   and — only shown when GST Registered is checked — **GSTIN**
   (auto-uppercased).
4. **Bank details** — Bank Name, A/c Holder, Account No., IFSC, UPI ID. This
   block feeds the payment details printed on invoices for this entity.
5. **Logo / Signature / Stamp / Payment QR** — each has an **Upload**
   button (goes through the general storage upload-URL flow) and, once set,
   a **View** link that opens a short-lived signed URL rather than a public
   one.
6. Click **Save** on that entity's card. Saving is per-entity, not global —
   each card has its own Save button and its own in-flight guard, so saving
   one entity never touches another's unsaved edits.

## What GST-registered actually changes

`is_gst_registered` isn't just a label — it's the flag `resolveEntityKey()`
and the invoicing logic read to decide whether GST applies at all for a
sale/invoice/repair job charged through this entity. Today Digitalbluez is
GST-registered (issues a proper GST invoice); Techtenth and Cash are not
(they issue a non-GST Bill of Supply instead) — this is exactly the
Digitalbluez=GST / Techtenth+Cash=non-GST entity split referenced elsewhere
in this system (e.g. repair-job GST, which computes tax only when the job's
resolved entity is GST-registered, never hardcoded to an account name).

## Steps — the Zoho transition mode ("invoicing_mode")

Each card has an amber-highlighted **"Invoices still generated in Zoho
(transition mode)"** checkbox (`invoicing_mode`):

1. While **ON** (`invoicing_mode = 'external'`), the ERP will **not**
   generate invoices for that entity at all — staff instead record the
   externally-issued (Zoho) invoice number manually via Sales Ledger →
   "Record Zoho Invoice #."
2. When you're ready for the ERP to take over invoice generation for that
   entity (cutover), **first** set its ERP invoice counter (next section) to
   match the last Zoho sequence number actually issued, **then** turn this
   checkbox **OFF** (`invoicing_mode = 'erp'`) — in that order, so the
   ERP's very first generated invoice continues the legal series unbroken
   rather than restarting from 1 or colliding with an already-used number.

## Steps — Set ERP invoice counter (Zoho cutover / migration)

This is the mechanism that makes the above cutover safe:

1. In the amber transition-mode box, enter the **last Zoho invoice
   sequence number** actually issued for that entity (just the number,
   e.g. `695` — not the full formatted invoice string) into "Last Zoho
   invoice #."
2. Click **Set ERP counter**. You're asked to confirm the exact next number
   this produces (e.g. "so the next generated invoice is #696?").
3. This calls `POST /api/business-profiles/[key]/set-invoice-counter`,
   which upserts `invoice_sequences` for that entity, `doc_type =
   'sales_invoice'`, and the **current financial year** — the ERP's
   `next_document_number`-style logic always mints `last_number + 1`, so
   setting `last_number` to the last Zoho sequence number makes the ERP's
   first invoice exactly the next one in sequence.
4. **The counter can never be moved backwards.** If it's already at, say,
   700 and you try to set it to 695, the API refuses with 409 ("Refusing to
   move it backwards... that could re-issue an already-used number") —
   this is a hard safety rail against accidentally re-issuing a legal
   invoice number that's already been used.

## Common mix-ups

- **"I turned off transition mode but forgot to set the counter first."**
  — the ERP will start generating invoices from wherever the counter
  already was (likely 1, or wherever it last stood), which will collide
  with or duplicate the Zoho series. Always set the counter *before*
  flipping transition mode off, not after.
- **"Why can't I add a fourth entity?"** — by design; the three keys are
  fixed at the database level, not a configurable list. A genuinely new
  legal entity would need a schema change, not just a new row here.
- **"GSTIN field disappeared when I unchecked GST Registered."** — expected
  UI behavior; the field is only shown (and presumably only meaningful) for
  a GST-registered entity.
