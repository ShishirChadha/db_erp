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
Impact: a separate `QuickAddCustomerDialog.tsx` (name/type/phone/email/address only) was built for Sell/Service instead of modifying the shared one — two components, not one component with conditional complexity.
