---
slug: manage-sku-category-templates
title: "Managing SKU category templates (field_schema)"
kind: process
audience: [owner]
module: inventory-sku
routes: []
keywords: [category template, field schema, sku fields, add category, new category, spec form, variant fields, category ka form, naya category]
sources:
  - apps/erp/app/api/sku-category-templates/route.ts
  - apps/erp/app/api/sku-category-templates/[category]/route.ts
  - apps/erp/components/SkuCategoryTemplatesManager.tsx
  - apps/erp/app/dashboard/settings/page.tsx
  - apps/erp/app/dashboard/sku-master/page.tsx
updated: 2026-09-16
---

## What this is

`sku_category_templates` is the schema that drives every SKU spec form (New
SKU, Stock Intake's inline create, the PO wizard's inline create-new-SKU all
read it via `CategorySpecFields`) — one row per category (`LAP`, `RAM`,
`ACC`, etc.) holding a `display_name`, a `sku_code_format` template string,
and a `field_schema` (the ordered list of spec fields, each with a type,
required flag, options, and optional `showIf` conditional visibility, plus
which fields count as "variant" fields for SKU generation).

## Where this is actually edited today — there is no reachable UI

A fully-built editor component exists in the codebase —
`components/SkuCategoryTemplatesManager.tsx` — that supports everything you'd
expect: editing a category's display name and SKU code format, adding/
reordering/removing fields, marking fields required or "variant," setting
`showIf` conditional fields, and creating a brand-new category from scratch.
It reads `GET /api/sku-category-templates` and writes through
`PATCH /api/sku-category-templates/[category]`.

**But it is not mounted anywhere in the app.** A repo-wide search turns up
exactly one reference to `SkuCategoryTemplatesManager` — its own file. It is
not imported by `app/dashboard/settings/page.tsx` (which explicitly imports
every other Settings manager component: `DropdownOptionsManager`,
`UserManager`, `BusinessProfileManager`, `TagsManager`,
`WebsiteAdminManager`, `FieldRedactionManager`, `DigestsManager`,
`MarketingSettingsManager`, `AppearanceManager`, `NavigationManager`, etc.),
nor by the SKU Master page, nor by any other dashboard route. There is no
"Manage Categories" button anywhere in the product today.

There's also a second, sharper problem if it *were* wired up: the manager's
"+ New Category" flow calls `POST /api/sku-category-templates`, but that
route file only exports a `GET` handler — no `POST` is implemented
server-side, so creating a brand-new category would fail with a 405 even if
the button existed. Editing an *existing* category's fields (`PATCH
/api/sku-category-templates/[category]`) is fully implemented and
owner-gated (`isOwner()`), and would work correctly if the component were
mounted — only the new-category creation path is broken end-to-end.

## Who can do this today

**No one, through the UI** — there's nothing to click. The only way to
change a category's `field_schema` right now is directly against the
database (e.g. via Supabase), or by having someone mount
`SkuCategoryTemplatesManager` as a new Settings tab and add the missing
`POST` handler to `app/api/sku-category-templates/route.ts` first.

## What the (unmounted) editor would do, if wired up

For reference — this is what `SkuCategoryTemplatesManager.tsx` already
implements, in case a future task is "just add the missing wiring":

1. Pick a category from the left-hand list.
2. Edit **Display Name** / **SKU Code Format**, "Save Category Info."
3. Under **Fields**: reorder with ▲/▼, edit label/type/required/"variant,"
   set select-field options, set a `showIf` (only relevant for
   checkbox-gated fields, e.g. Desktop's `includes_monitor` revealing
   `monitor_brand`/`size`/`resolution`), remove a field (existing SKUs keep
   whatever value is already saved for a removed field — it just stops being
   shown/editable going forward), "Save Fields."
4. **+ New Category**: enter a code and display name, creates an empty
   `field_schema`. The component's own copy warns that a developer still
   needs to register the category as serialized-vs-quantity-only elsewhere
   in the codebase, and add it to the legacy Purchases quick-entry dialog's
   Type dropdown if needed there too — this was never meant to be fully
   self-service even if wired up.
5. `category`, and each field's machine `name`, are locked once created —
   `sku_master.specifications` rows are already keyed by them (this is
   enforced server-side: the PATCH route rejects any rename of an existing
   field name via `findBlockedRenames`).

## Common mix-ups

- **"I looked all over Settings and SKU Master for this and couldn't find
  it."** — correct, it isn't there. This isn't a permissions issue; the
  feature is unreachable for everyone, including the owner.
- **"Can I at least create a new category through this if I find the
  component?"** — not without a code change first; the `POST` handler it
  needs doesn't exist yet.
