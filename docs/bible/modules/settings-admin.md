---
slug: settings-admin
title: Settings & Admin
kind: module
audience: [owner]
routes: [/dashboard/settings]
keywords: [settings, admin, configure, dropdown options, users, business profiles, tags, sku categories, digests]
sources:
  - apps/erp/app/dashboard/settings/page.tsx
updated: 2026-08-29
---

## What lives here

All owner-only configuration, tab by tab: Asset Numbering, Dropdown Options
(`custom_options`, see **inventory-sku**), SKU Category Templates (see
**inventory-sku**), Business Profiles, Users (roles + page/edit grants, see
**roles-permissions**), Activity Tags, Website Admin (see **website**), Field
Redaction (see **roles-permissions**), Digests.

## Generic owner-curated dropdown pattern

CPU, RAM, storage, staff names, and any similar picklist live in one
`custom_options` table (never a new table per list type), managed here, read
via `lib/useCustomOptions.ts` + `components/SearchableSelect.tsx`. New
dropdown types should follow this pattern.

## Related

**roles-permissions**, **inventory-sku**, **website**.
