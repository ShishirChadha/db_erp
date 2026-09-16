---
slug: configure-dropdown-options
title: Managing dropdown option lists (custom_options)
kind: process
module: settings-admin
audience: [owner]
routes: [/dashboard/settings]
keywords: [dropdown options, custom options, cpu list, ram list, storage list, brand list, model list, expense types, staff names, sold by, picklist, add option, new value, owner only value, searchable select, dropdown me add karo, list me naya value]
sources:
  - apps/erp/components/DropdownOptionsManager.tsx
  - apps/erp/app/api/custom-options/route.ts
  - apps/erp/app/api/custom-options/[id]/route.ts
updated: 2026-09-16
---

## What this is

Settings → Dropdown Options (`DropdownOptionsManager`) is the single owner
screen for curating every generic picklist in the app — CPU, RAM, storage,
brand, model (per device type), GPU, screen size, monitor resolution, Apple
model year, generation, expense types, stock intake type, and staff names
("Sold By"). All of these live in one shared `custom_options` table, never a
separate table per list — every searchable dropdown elsewhere reads from
here via `lib/useCustomOptions.ts` + `components/SearchableSelect.tsx`.

The known categories baked into this screen's selector are: `stock_intake_type`,
`expense_types`, `brand`, `model_laptop`, `model_desktop`, `model_tablet`,
`model_monitor`, `cpu`, `gpu`, `cpu_series`, `gpu_series`, `monitor_resolution`,
`apple_model_year`, `generation`, `ram`, `storage`, `screen_size_laptop`,
`screen_size_monitor`, `staff_names`. An **"Other category..."** option lets
you type any other category key directly (e.g. `warranty_type`) — the
underlying table isn't restricted to this fixed list, this dropdown just
shows the known ones for convenience.

## Who can do this

Viewing/using a category's values (`GET /api/custom-options`) only requires
being signed in — any role can read the active, non-owner-only options for a
category, which is what powers dropdowns on data-entry forms across the app.

**Adding** a brand-new value (`POST /api/custom-options`) is also open to
**any signed-in role**, not just the owner — e.g. an employee typing a
model/brand that doesn't exist yet on a Stock Intake form triggers this same
endpoint, an inline "quick add" outside this dedicated screen.

**Editing, deactivating, deleting, or marking a value "owner only"**
(`PATCH`/`DELETE /api/custom-options/[id]`) is owner-only — this dedicated
Settings screen itself is gated to the owner (`dropdown_options` tab,
`ownerOnly: true`), and those two endpoints independently enforce
`isOwner(sessionUser)` regardless of who's calling.

## Steps

1. Open **Settings → Dropdown Options**.
2. Pick a category from the dropdown, or choose **"Other category..."** and
   type a category key to manage a list not in the known set.
3. The list below shows every value for that category, including inactive
   ones (owner view passes `include_inactive=true`), with:
   - a **line-through** style for deactivated values;
   - an **"Owner only"** badge for values flagged that way.
4. To add a value, type it into the box at the bottom and click **Add** (or
   press Enter). Adding is **case/whitespace-insensitive deduplicated** —
   typing "Thinkpad T450" when "ThinkPad T450" already exists in that
   category returns the existing row instead of creating a duplicate.
5. To retire a value without losing history, click **Deactivate** on its
   row — this just flips `is_active`, it never deletes the row, so any past
   record that already used this value keeps displaying it correctly; it
   just stops showing up in the dropdown for new entries. **Activate**
   reverses it.
6. To restrict a value to the owner only (**"Make owner only"**), click that
   toggle on its row. A non-owner never sees this value in the dropdown at
   all — it's filtered out of the `GET` query itself
   (`.eq('owner_only', false)` when the caller isn't the owner), not shown
   and then hidden. This is meant for categories like `expense_types` where
   most values (e.g. "Office Supplies") are fine for staff to pick, but a
   few (e.g. "Salaries", "Bank Charges", "GST Payment") should never even be
   offered to an employee. **"Make visible to all"** reverses it.

## Common mix-ups

- **"An employee added a wrong-spelling duplicate."** — the dedup check is
  exact-match-insensitive only (normalized comparison), so genuinely
  different-looking values that mean the same thing (e.g. "8GB" vs "8 GB")
  can still both get created. Deactivate the bad one from this screen rather
  than deleting it if it's already been used anywhere.
- **"I don't see this dropdown anywhere else after adding it."** — check
  you added it under the correct category key; a form elsewhere only reads
  the specific category it's wired to via `useCustomOptions(category)`.
- **"Why is this expense type missing for an employee entering an
  expense?"** — it's probably flagged **owner only**; that's working as
  intended, not a bug.
- **Deleting vs. deactivating** — the API also supports a hard `DELETE`
  (owner-only), but the UI here only exposes deactivate/activate. Prefer
  deactivating any value that's ever been used historically; a hard delete
  is meant for cleaning up genuine mistakes like exact duplicates.
