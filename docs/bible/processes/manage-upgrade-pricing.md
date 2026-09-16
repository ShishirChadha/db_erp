---
slug: manage-upgrade-pricing
title: Setting up website upgrade pricing (RAM/SSD/warranty upsells)
kind: process
module: website
audience: [owner]
routes: [/dashboard/settings]
keywords: [upgrade pricing, upgrade rules, sku_upgrade_rules, ram upgrade, ssd upgrade, warranty upgrade, website upsell, checkout upgrade, upgrade before shipping, downgrade]
sources:
  - apps/erp/app/api/website-admin/upgrade-rules/route.ts
  - apps/erp/app/api/website-admin/upgrade-rules/[id]/route.ts
  - apps/erp/components/WebsiteAdminManager.tsx
  - apps/web/lib/order-to-sale.ts
  - apps/web/lib/upgrades.ts
  - apps/web/components/UpgradeSelector.tsx
updated: 2026-09-16
---

## What this is

The paid RAM/SSD/warranty-length upgrade options a customer can add to a
laptop or desktop on the website at checkout — configured here, never
hardcoded in the storefront. This is a **website checkout feature**, distinct
from **change-a-units-sku**, which is the in-store mechanism for recording a
spec change on a physical unit.

## Who can do this

Owner-only. Settings → Website Admin → **Upgrade Pricing** tab.

## Steps

1. Open **Settings → Website Admin → Upgrade Pricing**.
2. Add a rule: pick the **category** (e.g. `LAP`), the **field**
   (RAM / SSD / Warranty months — the only three fields this supports),
   a **from** value and a **to** value (e.g. `8GB` → `16GB`), and the
   **price delta** — what the customer pays extra for that specific step up.
   `from_value`/`to_value` can't be the same, and `price_delta` can't be
   negative.
3. Save. Rules can be toggled active/inactive without deleting them.
4. The website automatically offers matching rules as options on any
   published product in that category — nothing to configure per-SKU.

## What happens when a customer buys an upgrade

- **RAM/SSD upgrades are a real, physical modification service** — the
  system has no way to hand the customer an already-upgraded physical unit
  automatically (inventory reservation happens by SKU alone, with no
  spec-awareness). So instead of silently doing nothing, a paid RAM/SSD
  upgrade creates a **high-priority task in Activities**, assigned to the
  owner, titled "Upgrade before shipping: ..." with the spec change and
  linked to the sale — the honest way to make sure it actually gets done
  before the unit ships, not a promise the system can't keep silently.
- **A warranty-length upgrade needs no physical action** — it just extends
  `asset_ledger.warranty_duration_months`/`warranty_start_date` directly at
  order time (defaulting `warranty_type` to `in_house` if not already set).
- Every upgrade selected at checkout is priced server-side at order time and
  baked into the sale's actual `unit_price` — never left as just display
  metadata (see **business-rules**), so it always shows correctly in
  Reports/GST, not just on the order confirmation.

## Common mix-ups

- **"Why can't I add an upgrade for CPU/screen size/etc.?"** — only `ram`,
  `ssd`, and `warranty_months` are supported fields; this is a DB-level CHECK
  constraint on `sku_upgrade_rules`, not a UI limitation.
- **"A customer bought a RAM upgrade — where does staff see that they need
  to actually do it?"** — Activities (assigned to the owner), not anywhere
  on the Sales/Orders screens directly.
- **"Does this affect in-store sales?"** — no; in-store staff use
  **change-a-units-sku** instead, which has nothing to do with these rules.
