---
slug: create-and-edit-a-sku
title: Creating and editing a SKU
kind: process
audience: [owner, manager, employee]
module: inventory-sku
routes: [/dashboard/sku-master, /dashboard/accessories, /dashboard/purchase-orders/new, /dashboard/entry/intake]
keywords: [new sku, create sku, naya sku banana, edit sku, sku edit karna, sku form, spec fields, category fields, field schema, sku code auto generate]
sources:
  - apps/erp/components/SkuFormModal.tsx
  - apps/erp/components/CategorySpecFields.tsx
  - apps/erp/app/api/sku-master/route.ts
  - apps/erp/app/api/sku-master/[id]/route.ts
  - apps/erp/app/dashboard/sku-master/page.tsx
updated: 2026-09-16
---

## What this is

Creating a new catalog entry in `sku_master` (any category — laptop,
desktop, monitor, tablet, or any accessory), or editing an existing one, via
`SkuFormModal`. This one shared modal appears in several places: SKU Master's
"+ New SKU"/"Edit", the New PO wizard's inline "+ Create new SKU", Stock
Intake's inline create, and Accessories' "+ New SKU". Which spec fields the
form shows — and which are required — is entirely driven by the selected
category's `sku_category_templates.field_schema` (see
**manage-sku-category-templates** for where that schema itself is edited).

## Who can do this

This is one of the few forms where **create and edit have different gates**:

- **Creating a SKU** (`POST /api/sku-master`) only requires page access to
  `sku_master` or `new_entry` — `hasPageAccess(sessionUser, ['sku_master',
  'new_entry'])`. Any signed-in staff member with access to either of those
  pages can create a new SKU; this is **not** owner-only. `base_cost` is the
  one exception — a non-owner's submitted `base_cost` is silently ignored
  server-side rather than saved.
- **Editing a SKU** (`PUT /api/sku-master/[id]`) is owner-only for every
  field *except* the website-publishing fields (`is_published`, `web_price`,
  `market_price`, `web_slug`, `web_title`, `web_description`,
  `web_highlights`, `web_condition_grade`) — those can also be updated by
  anyone with the `website` page edit grant, and *only* if the request body
  contains nothing but those fields (mixing in any other key still requires
  `isOwner`).

The SKU Master page itself shows the **Edit** button to everyone who can see
the page (it isn't conditionally hidden by role), so a non-owner with
`sku_master` access can open the edit form — it will fail with `401/403`
on submit unless they're only touching website fields via the `website`
grant. In practice this mostly matters for staff with `sku_master` access
but not `owner`: they can add brand-new SKUs freely but can't correct an
existing one's specs/price/brand — that has to go to the owner, or through
**change-a-units-sku** if it's really a per-unit correction rather than a
catalog-wide one.

## Steps

1. Open **New SKU** (or **Edit** on an existing row) from SKU Master,
   Accessories, the PO wizard's item search, or Stock Intake.
2. **Pick the category.** This selects which `sku_category_templates` row
   drives the rest of the form — each category has its own field list (e.g.
   Laptop has CPU/RAM/SSD/screen size; a generic accessory (`ACC`) may have
   almost none). Changing category on a *new* SKU resets the specs entered so
   far.
3. **Fill in the category's spec fields** (`CategorySpecFields`) — each
   renders as a text/number input, checkbox, fixed select, or a
   `custom_options`-backed searchable dropdown depending on the field's
   `type`; fields marked `required` in the schema must be filled before the
   SKU code can auto-generate. A field can also be conditionally shown only
   when another checkbox field is checked (`showIf`).
4. **SKU Code** auto-generates from the category's `sku_code_format`
   template once every placeholder spec is filled (e.g.
   `{brand}`/`{model}`) — shown as a live preview, and always editable by
   hand before saving.
5. **Description** auto-generates by joining the filled spec values, and
   switches to fully manual once you type in it yourself
   (`descManuallyEdited`).
6. Optionally set **HSN Code**.
7. Submit. On create, this calls `resolveOrCreateSku` — if the exact same
   category+specs already exists, it returns that existing SKU instead of
   creating a duplicate (`possible_duplicates` may also come back as a
   near-match warning even on a genuinely new SKU, prompting a toast to go
   review/merge on the SKU Master page instead of keeping two rows).

## Common mix-ups

- **"I have SKU Master access but Edit says Unauthorized."** — expected: page
  access lets you *view and create*, not necessarily edit. Editing (beyond
  website fields) is owner-only regardless of what the page shows you.
- **"My new SKU has the same specs as one that already exists."** — creation
  is a resolve-or-create: submitting identical category+specs to an existing
  SKU returns that SKU rather than making a second row. A near-match (not
  exact) instead surfaces a "looks similar" toast — see
  **merge-duplicate-skus** if that's really the same item.
- **"I edited specs and got a 409."** — the API blocks saving specs that
  would exactly match another existing SKU under the same base code; use
  **change-a-units-sku**'s "Fix SKU" on the affected unit(s) to reassign them
  to the existing SKU instead of editing this one to collide with it.
- **"I changed the category on an existing SKU and the spec fields look
  wrong."** — `category` is technically in the PUT route's editable field
  list (owner-only), and the form's Category dropdown stays enabled while
  editing, but switching category on an *existing* SKU doesn't clear the old
  `specifications` the way it does on a brand-new SKU — you'll see the new
  category's field list rendered against the old category's leftover spec
  values. Prefer creating a fresh SKU (or **merge-duplicate-skus**) over
  recategorizing an existing row for this reason. A field's machine `name`
  itself, and the category *template's* own code, are what's actually locked
  — see **manage-sku-category-templates**.
