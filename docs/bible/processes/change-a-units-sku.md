---
slug: change-a-units-sku
title: "Changing a unit's SKU (recording a spec upgrade or downgrade)"
kind: process
module: inventory-sku
audience: [owner, manager, employee]
routes: [/dashboard/stock, /dashboard/entry/sell]
keywords: [fix sku, change sku, reassign sku, upgrade, downgrade, ram upgrade, ssd upgrade, spec change, wrong sku, correct sku, current_sku_id, component stock, upgraded ram, upgraded ssd]
sources:
  - apps/erp/components/FixSkuDialog.tsx
  - apps/erp/app/api/asset-ledger/[id]/reassign-sku/route.ts
  - apps/erp/lib/effective-sku.ts
  - apps/erp/app/api/asset-ledger/[id]/component-upgrade-skip/route.ts
  - apps/erp/app/api/asset-ledger/[id]/component-stock-adjustment/route.ts
updated: 2026-09-19
---

## What this is

Changing which SKU a specific unit (one row in `asset_ledger`) currently
represents — either because it was mis-entered originally, or because staff
physically upgraded or downgraded a component (most often RAM or SSD) before
reselling it. This is the "upgrade/downgrade" functionality that lives on a
unit itself — separate from **manage-upgrade-pricing**, which is the
*website's* paid checkout upsell feature.

Two entry points share the same dialog (`FixSkuDialog`, titled "Change SKU"
or "Fix SKU" depending on where it's opened):
- **Stock page** ("Fix SKU" button) — correcting a data-entry mistake.
- **Sell form** ("Change SKU") — recording a real physical upgrade right
  before the sale.

## Who can do this

Open to any signed-in staff member with the edit grant on the page it's
opened from (the Stock page's edit grant, or New Entry access for the Sell
form) — **not owner-only**, unlike most SKU-master editing. The optional
"additional cost" field is owner-only, since cost is never shown to
employees.

## What it does and doesn't change

It only ever sets `current_sku_id` on **this one unit** — never
`asset_ledger.sku_id` or `purchase_order_items.sku_id`, which stay an
accurate record of what was actually purchased, no matter what happens to
the unit afterward. So:
- It never rewrites the original Purchase Order.
- It never affects any sibling unit that shares the same PO line item.
- Everywhere else that reads a unit's "current" spec (Sales Ledger, Live
  Stock, the website) resolves it through `current_sku_id` first, falling
  back to the original purchased spec — see **inventory-sku**.

If the unit is already on a **finalized invoice**, reassigning warns first
("this will NOT update that invoice, which will then disagree with the live
system") and requires an explicit confirm to proceed — it doesn't block it
outright, since a real physical upgrade after invoicing is a legitimate
situation, just one worth a conscious decision.

## Steps

1. Open **Change SKU** / **Fix SKU** on the unit.
2. Search for the correct SKU, or create a new one on the spot if it doesn't
   exist yet.
3. Confirm the reassignment.
4. If the unit is already on a finalized invoice, confirm again explicitly.
5. (Owner only, optional) Enter the additional cost and a reason — this is
   recorded as a cost adjustment on the unit, the same mechanism the Stock
   page's cost-adjustment history uses. Use this for costs that *don't* come
   from our own accessory stock (labor, a part bought fresh for this job) —
   a component actually pulled from our own stock costs itself automatically
   at step 6, no need to double-enter it here.
6. **If RAM or SSD actually changed** (the only two fields this
   automatically diffs), a follow-up step appears — one row per changed
   field:
   - **Upgrade** (e.g. RAM 8GB → 16GB): "if it came from your own accessory
     stock, deduct it now" — optionally search for the RAM/SSD SKU that was
     used and deduct it from stock. The owner sees a live cost estimate
     (quantity × that SKU's last purchase price) before confirming.
   - **Downgrade** (e.g. SSD 512GB → 256GB): "log the removed component back
     into stock?" — optionally search for the SKU and receive it back in.
   - Either row can be skipped if it doesn't apply (e.g. the part was
     sourced externally, not from our own stock) — **but skipping now
     requires typing a reason** (2026-09-19). This isn't optional anymore:
     you can't close this step without resolving every changed row, one way
     or the other.

## Component swaps cost themselves automatically (2026-09-19)

Deducting (or receiving back) an accessory in step 6 now **also** records the
cost of that swap against the unit — priced from that accessory SKU's own
last-recorded purchase price × quantity, added for an upgrade or subtracted
for a downgrade. **Multiple changed fields simply add up**: if both RAM and
SSD changed, each gets costed independently and both amounts land on the
same unit's cost history — no need to manually total them. This is on top
of, not instead of, the manual "Additional cost" field from step 5 (that
one's still for costs outside our own accessory stock). All of it — the
original purchase price, the manual field, and every auto-costed component
swap — is what actually feeds the unit's COGS in revenue/margin reporting
(`v_report_sale_lines`) once it sells.

This happens **no matter who performs the swap** — an employee fixing a
QC-failed unit still costs it correctly, they just never see the amount
(cost figures stay owner-only everywhere, including here — the number is
simply never sent to a non-owner, not just hidden in the UI). If the
accessory SKU has never been received with a price on record, nothing is
auto-costed for that row (the owner sees "no purchase price on record" both
in the estimate and the confirmation) — add it manually via Cost Adjustments
if you know the real figure.

A reassignment that doesn't change RAM/SSD (a plain data-entry correction, or
a change to some other field) skips the follow-up step entirely and closes
immediately.

## "No RAM"/"No SSD" is correctly treated as zero (fixed 2026-09-19)

This business's real data records a bare unit's RAM/SSD as the literal text
`"No"` (not a number, not a blank) — e.g. a unit bought with no RAM installed
has `specifications.ram = "No"`. The diff that detects an upgrade/downgrade
originally only understood numeric-looking values ("8GB" → 8) and silently
**skipped** anything it couldn't parse as a number — so reassigning a "No
RAM" unit to a real "8GB RAM" SKU never triggered the follow-up at all, the
one case this feature most needs to catch. Fixed: any RAM/SSD value with no
digits in it (`"No"`, `"N/A"`, blank, missing) is now treated as **zero
capacity**, not skipped — "No" → "8GB" correctly reads as a 0→8 upgrade. Two
genuinely-zero values on both sides (e.g. "No" → "") still correctly detect
no change.

## Why the follow-up can't be skipped silently (2026-09-19)

Before this, "Skip" was a single click with no trace — a unit's SKU could say
"16GB RAM" while nothing was ever actually deducted from accessory stock,
and nothing anywhere would show that happened or why. Now: the **Done**
button on the follow-up step stays disabled (as does closing via the X or
clicking outside — same underlying close handler) until every changed row is
resolved. A row is resolved by either actually moving the accessory stock
(as before), or by clicking Skip, typing a reason (e.g. "customer supplied
their own RAM"), and confirming — which is recorded to the **Audit Log**
(`POST /api/asset-ledger/[id]/component-upgrade-skip`) so there's always a
findable answer to "why doesn't the accessory count match this unit's spec."

## Common mix-ups

- **"I changed the SKU but nothing asked about stock."** — the automatic
  upgrade/downgrade follow-up only fires for RAM and SSD specifically; other
  spec fields (CPU, screen size, etc.) don't trigger it.
- **"I can't close the dialog."** — every changed RAM/SSD row needs to be
  resolved first (stock moved, or skipped with a reason) — see above. This is
  intentional, not a bug.
- **"Why didn't this update the Purchase Order?"** — by design; see "What it
  does and doesn't change" above. Use **po-corrections** if the PO record
  itself is actually wrong.
- **"The invoice still shows the old spec."** — expected; a finalized
  invoice is a frozen snapshot and is never retroactively updated by a later
  SKU reassignment.
- **A unit reassigned from "No RAM"/"No SSD" before 2026-09-19** never got the
  follow-up prompt (see above) — its accessory stock was never deducted even
  if a real part was used. There's no automatic way to detect which past
  reassignments this affected; if you know of one, reopen **Fix SKU** on that
  unit — since its spec is already correct, the diff won't re-fire — so
  record the accessory deduction as a plain stock adjustment
  (`/dashboard/accessories` on the RAM/SSD SKU, "Correct Quantity") instead.
