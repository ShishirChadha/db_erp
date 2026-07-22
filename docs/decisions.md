# Architectural & Business Decisions

Chronological. Each entry: the decision, why, and its impact.

---

**One shared `asset_ledger` for every unit, regardless of how it entered the system.**
Why: the app previously ran two disconnected purchasing pipelines (legacy `purchases` table vs. `purchase_orders`/`purchase_order_items`/`purchase_order_asset_mapping`), neither of which supported grading/QC, warranty, RMA, or sale-time stock decrement. Rather than build those features twice, `purchase_order_asset_mapping` was renamed to `asset_ledger` and extended with provenance (`source`), grading, warranty, and sale-linkage columns; both entry doors write into it.
Impact: every downstream feature (QC, sale, repair, RMA) is built once against one table. A `source` column (`purchase_order` / `legacy_purchase` / `employee_intake`) preserves where each row came from.

---

**API-layer role enforcement, not RLS, not middleware.**
Why: almost every existing route already used the Supabase service-role client (`supabaseAdmin`), which bypasses RLS entirely — so tightening RLS policies would not have closed the actual exposure. There is also no `middleware.ts` in this app.
Impact: `lib/auth/session.ts` resolves the caller's role from the Bearer token (or cookie, for server components) inside each route handler; `lib/auth/redact.ts` strips sensitive fields from responses. Page-level guards (`RequireOwner`) exist for UX only and must never be treated as the real boundary.

---

**Employee-facing routes are secure by construction, not by retrofit.**
Why: retrofitting redaction onto every existing route is repetitive and easy to miss on a new route. New routes built for the employee-facing system are written to never `.select()` sensitive columns for a given code path in the first place.
Impact: `lib/auth/redact.ts`'s field-stripping approach is reserved for existing/legacy routes; new routes should design their query to not fetch what they don't need to return.

---

**Employee entries are immediately real; the owner's job is deferred paperwork, tracked by derived flags.**
Why: the owner initially asked for a two-stage capture → owner-approves model (Part 5 of the plan), then reversed this after using it — an approval gate meant stock/sold lists weren't trustworthy for real-time warranty lookups, and it put the owner in the middle of every transaction. The revised principle: an employee's action (stock in, stock out) is true the moment it happens; the owner does bookkeeping (PO, invoice) later, whenever they get to it.
Impact: intake writes a live `stock_movements` receipt and `asset_ledger` row immediately; sales write `status='sold'` and the stock/accessory decrement immediately; a repair "replacement" swap marks the given-out unit `sold` immediately. None of these wait for an owner action. "Has paperwork been done?" is always computed from existing relationships (`asset_ledger.po_id IS NULL`, `sales.finalized`), never a separate boolean — a separate flag can silently drift from what's actually true; a derived one cannot.

---

**Asset numbers are a Purchase-Order artifact, not an inventory-existence requirement.**
Why: numbering happens through an atomic sequence (`reserve_assets()` RPC) specifically because numbers are meant to correspond to a committed purchase — minting one for an employee's unreviewed intake entry (an earlier iteration of this design briefly did this) wastes numbers on units that might later turn out to be duplicates, mistakes, or otherwise never actually purchased through a real PO. Separately, the owner pointed out that QC and purchase-paperwork happen on independent schedules — a unit can be sold before the owner ever gets around to its PO.
Impact: `asset_ledger.asset_number` stays `NULL` from intake through QC through sale — identification during that whole window is by `serial_number` + row id. `POST /api/purchase-orders/from-intake` is the only code path that ever calls `reserve_assets()` for these units, and it accepts units in *any* status (including already-`sold`), because attaching purchase paperwork must never be blocked by, or itself block, the unit's operational lifecycle.

---

**Live Stock (employee-facing) and Stock/Main ERP (owner's historical reconciliation) are the same table, deliberately shown as two non-overlapping views.**
Why: the owner is manually reconciling a large backlog of historical/legacy stock data separately from day-to-day new-stock operations, and asked for these to be kept apart so neither activity confuses or interferes with the other — "connecting" them is a deliberate future step, not automatic.
Impact: both views query `asset_ledger` filtered by `source` (`=employee_intake` vs `!=employee_intake`) rather than living in separate tables — reconciling them later is a matter of removing a filter, not running a data migration. Implemented as one parameterized component (`components/StockView.tsx`) mounted at two routes, not two forked copies.

---

**`sold_by` is a plain owner-curated name, not a login-account foreign key.**
Why: incentive/commission attribution needs to work for staff who may not have (or may share) a login account, and shouldn't be forced to match whoever happened to be logged in when a sale was typed up.
Impact: `sales.sold_by` was migrated from `uuid references auth.users(id)` to plain `text`, sourced from the existing generic `custom_options` dropdown system (`category='staff_names'`) rather than a new staff table — reusing infrastructure already built for CPU/RAM/storage dropdowns.

---

**"Received Into" (payment account) is independent of "Sale Type" (GST/Cash).**
Why: which of the business's two accounts (or cash) received a payment is an orthogonal fact to whether the sale itself was invoiced as GST or cash — a GST sale can still be paid into either account.
Impact: `sales.payment_account` and `repair_jobs.payment_account` are separate columns from `sale_type`, both free values from a fixed set (`Digitalbluez`/`Techtenth`/`Cash`), not derived from or coupled to the GST/Cash distinction.

---

**Payment tracking uses amount-paid vs. balance-due, not a binary flag.**
Why: real sales include partial payments/deposits, not just "paid" or "not paid."
Impact: `sales.payment_status` (`pending`/`partial`/`paid`) plus `amount_paid` (numeric); balance due is computed (`sale_total - amount_paid`), never stored, avoiding a second value that could disagree with the first two.

---

**Standalone "Owner Review" queue page removed in favor of in-context actions.**
Why: a separate queue page duplicated information already visible in the Stock pages and felt like unnecessary extra navigation; the owner preferred working directly in the same lists.
Impact: "needs PO"/"needs invoice" surfaced as inline flags + a count banner on the Stock pages themselves (owner-only columns/actions on the same table employees use); the two leftover categories that didn't have a natural home (pending accessory types, open repair jobs) got their own small list pages instead of a shared queue.

---

**No dummy/placeholder purchase invoices, ever.**
Why: 751 historically-migrated Purchase Orders have no linked invoice at all. Creating a PI is already fully decoupled from PO creation time in the schema (`POST /api/purchase-invoices` just needs an existing `po_id`), so there's no technical reason to fabricate a placeholder — whenever a real invoice surfaces (even years later), it's just one real PI creation, same as for a brand-new purchase.
Impact: those 751 POs stay `po_status='received'` with no invoice indefinitely; this is a bookkeeping backlog item, not a blocker on anything operational (a unit with no PI is still fully sellable/gradeable).

---

**Legacy quick-entry customer/vendor CRM forms are not touched by the new quick-entry flows.**
Why: `AddCustomerDialog.tsx` (full CRM form, GST fields, marketing-source tracking) is still needed as-is on the main Customers management page; the Sell/Service quick-entry screens needed a much lighter version and editing the shared component in place would have added noise to the main CRM page's field set for no benefit there.
Impact: a separate `QuickAddCustomerDialog.tsx` (name/type/phone/email/address only) was built for Sell/Service instead of modifying the shared one — two components, not one component with conditional complexity. Later revised (2026-07-22): Has GST / GST Number were added back conditionally (only when type=Business) after the owner hit this gap selling to a business customer — GST is needed for that customer type specifically, not for the lightweight default (Individual).

---

**Asset-number reconciliation must be numeric/format-aware, not lexicographic.**
Why: two admin tools (`app/api/settings/asset-counters/route.ts`, and formerly a step in PO hard-delete) found "the current max asset number for a prefix" via `.order('asset_number', desc).limit(1)` — a plain string sort. Once old-format numbers (`DBAS682`, no year) and new-format numbers (`DBAS26-699`, with year) coexist under the same prefix, string order can rank the old one higher (`'6' > '2'` at the first differing character), silently resetting the counter to the wrong value. This is what let a real PO's numbering jump from the last real unit (`DBAS682`) to `DBAS26-699` instead of continuing at 683 — an earlier reservation had already run ahead due to this exact bug plus an unrelated non-transactional reserve-then-write gap in PO submission (still open, see below).
Impact: both reconciliation tools now filter candidates to `^PREFIX\d{2}-\d+$` matching the target year, then compare the extracted integer — never a raw string sort. PO hard-delete's equivalent step was removed outright rather than fixed (see next entry).

---

**PO hard-delete no longer tries to "recover" reserved asset numbers on delete.**
Why: recalculating the counter back down when a PO is deleted actively fights this project's own numbering design (`reserve_assets()` is an atomic, never-reused sequence — a cancelled purchase's numbers are meant to just be spent, not clawed back) and was the concrete source of the lexicographic-sort bug above.
Impact: `app/api/purchase-orders/[id]/hard-delete/route.ts` no longer touches `asset_counters` at all. Deleting a PO leaves the counter wherever it is — a small, permanent gap, which is the accepted behavior per the original numbering ADR, not a bug to re-introduce a fix for.

---

**Legacy (pre-2026) asset numbers were renamed to match the current format.**
Why: 697 legacy `asset_ledger` rows used old, inconsistent formats (`DBAS0001`-`DBAS682`, `C0001`-`C0024` — an even older Cash prefix predating today's `CSAS` — `SHIS1`, and 2 malformed numbers). The owner asked for these aligned to the current `PREFIX<YY>-<seq>` format rather than left as permanent legacy noise, accepting the risk that these numbers may already be on physical tags/old invoices.
Impact: each row was renamed using its *real* historical purchase year (from its linked PO's `po_date` — the 2026-05-15 bulk-migration timestamp on the rows themselves is unrelated to when units were actually purchased), sequenced chronologically within each (prefix, year) bucket. The original number is preserved in a new `asset_ledger.legacy_asset_number` column specifically so a physical tag or an already-issued document can still be cross-referenced after the rename. `asset_counters` was corrected to match. Verified zero collisions and zero remaining old-format rows before considering this done.

---

**Reassigning a unit's SKU is open to both roles; editing SKU master specs stays owner-only.**
Why: correcting which SKU an asset is linked to (a data-entry mistake, or a physical upgrade discovered at sale time) never reads or writes cost/vendor data — unlike editing a SKU's own specifications in `sku_master`, which does. Restricting reassignment to the owner would have forced every employee who notices a wrong/upgraded unit at the point of sale to interrupt the owner instead of just fixing it.
Impact: `PATCH /api/asset-ledger/[id]/reassign-sku` requires only a valid session, not `isOwner`. `PUT /api/sku-master/[id]` (editing specs) remains owner-gated. The Stock view's "Fix SKU" button stays owner-only by UI choice (a power-user correction tool), while the Sell form's "Change SKU" (same underlying dialog, `components/FixSkuDialog.tsx`) is shown to both roles — the permission boundary lives in the route, not the button.

---

**Cost of upgrading a specific unit before resale is an append-only ledger, not a single field.**
Why: a unit's `cost_price` is set once at purchase time; there was no way to record that a specific unit later had money spent on it (added RAM, a bigger SSD) before resale, which matters for accurate margin. A single overwritable "extra cost" field would lose history if a unit is upgraded more than once and can't say who added what or when.
Impact: new `asset_cost_adjustments` table (`asset_id`, `amount`, `reason`, `added_by`, `created_at`) — same idiom as `stock_movements`/`asset_qc_checks` elsewhere in this codebase. Owner-only end to end (`GET`/`POST /api/asset-ledger/[id]/cost-adjustments`, optionally filled in from the Fix-SKU dialog at the moment of a reassignment, or anytime from the asset detail page's Cost Adjustments panel) — employees never see or set it, consistent with cost/vendor redaction everywhere else.

---

**RAM/SSD spec entry moved from free-typed number+regex to a `custom_options` dropdown; combined configs are their own atomic entries, not parsed.**
Why: `SkuFormModal` and `AddPurchaseDialog` typed RAM/SSD as plain numbers with a regex-normalization rule (`(\d+)` — extract the first number). That rule silently collapsed any combined-module string (e.g. "8GB + 8GB") down to "8", making a dual-8GB unit indistinguishable from a genuine single-8GB unit in SKU-variant matching. Once entry is dropdown-only, the regex extraction became unnecessary *and* actively harmful.
Impact: RAM/SSD/Storage fields switched to `text` + `custom_options`-backed `SearchableSelect` (same pattern already used correctly in Stock Intake), with the regex-normalization rule removed entirely rather than replaced — `normalizeSpecifications` already no-ops safely when no rule is present. A combined configuration is added as its own literal `custom_options` value (e.g. `"8GB + 8GB (16GB)"`) alongside the atomic ones, so it compares as a fully distinct string with zero parsing logic. Existing catalog data was migrated from bare numbers to the matching canonical strings so old and new entries keep resolving to the same SKU variants.
