-- Backup taken 2026-07-21, before Phase 0 / Step 2 (sku_master.quantity_in_stock
-- trigger-maintained cache) of the purchase-module unification plan.
-- Source: live Supabase project queried via mcp__supabase__execute_sql.
--
-- This step is additive at the DB level (new trigger + function on stock_movements;
-- no existing rows are modified, no tables/columns dropped). The only destructive-ish
-- change is removing the manual `UPDATE sku_master SET quantity_in_stock = ...` blocks
-- from app/api/purchase-orders/[id]/receive/route.ts and .../hard-delete/route.ts —
-- both are tracked in git, so this file exists as a data-level safety net, snapshotting
-- the exact quantity_in_stock values immediately before the trigger goes live.
--
-- KNOWN PRE-EXISTING ISSUE (found during this step, not caused by it): for the 3 SKUs
-- that already have stock_movements rows, the cached quantity_in_stock does NOT match
-- the movement-ledger sum (see reconciliation query below). This predates this session.
-- The new trigger does not retroactively fix this -- it only governs future inserts.
-- Full historical reconciliation is scoped to Phase 2 of the plan.

-- ============================================================
-- Reconciliation snapshot (informational): cached qty vs stock_movements sum, at backup time
-- ============================================================
-- sku_id                                | full_sku_code                              | cached_qty | movements_sum | diff
-- de6926b9-a76f-4187-ad8d-351261cddf60  | SKU-RAM-CONSISTENT-8-DDR4-2666-LAPTOP-001  | 0          | 1              | -1
-- 6717294e-0c3c-49dc-8557-0b05bb579324  | SKU-LAP-DELL-LAT-5400-001                  | 0          | 2              | -2
-- ee06a276-9eaf-4c84-a9e0-d87c7db0d385  | SKU-LAP-HP-ELITEBOOK-830-G7-001            | 0          | 3              | -3

-- ============================================================
-- Full snapshot of sku_master.quantity_in_stock (49 rows) immediately before this step
-- ============================================================
-- Restore with: UPDATE sku_master SET quantity_in_stock = <qty> WHERE id = '<id>';

UPDATE sku_master SET quantity_in_stock = 4 WHERE id = '4fd49338-8520-4139-b104-98d1f6599d24'; -- SKU-DES-HP
UPDATE sku_master SET quantity_in_stock = 3 WHERE id = 'dae6ecf3-400d-4afe-b359-b2d82d766d44'; -- SKU-DES-LENOVO
UPDATE sku_master SET quantity_in_stock = 2 WHERE id = 'f451af2c-aff8-46db-80b3-e9dddd1f9a36'; -- SKU-DES-LENOVO-TINY
UPDATE sku_master SET quantity_in_stock = 21 WHERE id = 'eb98f8ba-c084-4e13-87e1-fc42f30e7426'; -- SKU-DES-UNK-MODEL
UPDATE sku_master SET quantity_in_stock = 1 WHERE id = 'f69e621b-3df2-4083-95b6-69a91458403e'; -- SKU-LAP-ACER-GAMING-LOT
UPDATE sku_master SET quantity_in_stock = 2 WHERE id = '3442695c-29ae-4fd5-b0e4-11d3d49dd9e6'; -- SKU-LAP-APPLE-2141-OLD
UPDATE sku_master SET quantity_in_stock = 1 WHERE id = 'dbd840ea-9475-4fc1-b509-0013c163ac6e'; -- SKU-LAP-APPLE-A1708
UPDATE sku_master SET quantity_in_stock = 2 WHERE id = '419c2462-f115-4053-9c6c-79d87e84b8ac'; -- SKU-LAP-APPLE-MACBOOK-AIR-1466
UPDATE sku_master SET quantity_in_stock = 5 WHERE id = 'e1907d4d-69a2-4442-8463-6cf07e062876'; -- SKU-LAP-APPLE-MACBOOK-PRO-1398
UPDATE sku_master SET quantity_in_stock = 2 WHERE id = 'ccce4c64-cff9-4938-8059-1b8bda37a9aa'; -- SKU-LAP-APPLE-MACBOOK-PRO-2141
UPDATE sku_master SET quantity_in_stock = 5 WHERE id = '4172f417-bc95-452a-b83b-c7b4c8df0696'; -- SKU-LAP-APPLE-MACBOOK-PRO-2338
UPDATE sku_master SET quantity_in_stock = 1 WHERE id = '7dd37c1d-dc22-44c6-9b44-e3d75cf9b3fc'; -- SKU-LAP-APPLE-MACBOOK-PRO-2485
UPDATE sku_master SET quantity_in_stock = 9 WHERE id = '910f6605-b2ed-4000-aeff-e8aca91d5304'; -- SKU-LAP-APPLE-MACBOOK-PRO-A2251-004
UPDATE sku_master SET quantity_in_stock = 0 WHERE id = '6717294e-0c3c-49dc-8557-0b05bb579324'; -- SKU-LAP-DELL-LAT-5400-001
UPDATE sku_master SET quantity_in_stock = 15 WHERE id = 'bcf4492e-e7e2-4ea5-8645-65f0a5977f4d'; -- SKU-LAP-DELL-LATITUDE-3400
UPDATE sku_master SET quantity_in_stock = 8 WHERE id = '919f3100-9f41-46dc-8842-b57378246124'; -- SKU-LAP-DELL-LATITUDE-3410
UPDATE sku_master SET quantity_in_stock = 1 WHERE id = '53b4ba9d-6ca7-4fff-8bd4-905711f35d0c'; -- SKU-LAP-DELL-LATITUDE-5400
UPDATE sku_master SET quantity_in_stock = 6 WHERE id = '09977d55-4934-4b13-bcd5-a16fe50e4cde'; -- SKU-LAP-DELL-LATITUDE-5410
UPDATE sku_master SET quantity_in_stock = 2 WHERE id = 'efee9ae1-280c-44b9-b0ac-a8c9dc918c09'; -- SKU-LAP-DELL-LATITUDE-5411
UPDATE sku_master SET quantity_in_stock = 30 WHERE id = 'd70fff28-1187-42de-b00c-99ec222c0207'; -- SKU-LAP-DELL-LATITUDE-E5320
UPDATE sku_master SET quantity_in_stock = 2 WHERE id = '36ecbe18-88a5-4fe0-8819-d58186ee4e80'; -- SKU-LAP-HP-ELITEBOOK-360-1040-G8
UPDATE sku_master SET quantity_in_stock = 3 WHERE id = '18a1ae2f-4ef7-4cb8-86e3-bed5cb86b8cd'; -- SKU-LAP-HP-ELITEBOOK-830-G7
UPDATE sku_master SET quantity_in_stock = 0 WHERE id = 'ee06a276-9eaf-4c84-a9e0-d87c7db0d385'; -- SKU-LAP-HP-ELITEBOOK-830-G7-001
UPDATE sku_master SET quantity_in_stock = 0 WHERE id = 'ae2a2ff4-8107-42e2-9e65-87c9e81b1163'; -- SKU-LAP-HP-ELITEBOOK-830-G7-003
UPDATE sku_master SET quantity_in_stock = 1 WHERE id = '4312b0ba-3b58-4113-a2b0-832555f1a6f9'; -- SKU-LAP-HP-ELITEBOOK-840-G7
UPDATE sku_master SET quantity_in_stock = 2 WHERE id = '571295e9-64d9-427f-b6b6-1edee5a17f1a'; -- SKU-LAP-HP-ELITEBOOK-840-G8
UPDATE sku_master SET quantity_in_stock = 3 WHERE id = '213f4d3c-1041-409c-b67a-c05794603c35'; -- SKU-LAP-HP-ELITEBOOK-840-G8-001
UPDATE sku_master SET quantity_in_stock = 1 WHERE id = '26c45e5e-4428-4f51-88a5-66ce50f0a77e'; -- SKU-LAP-HP-HP-240-G10
UPDATE sku_master SET quantity_in_stock = 2 WHERE id = '634b8fa1-343f-4313-9901-b38b2cf7706c'; -- SKU-LAP-HP-PROBOOK-450-G7
UPDATE sku_master SET quantity_in_stock = 1 WHERE id = '7048b4af-a3f7-41fc-8567-4c9045f55a45'; -- SKU-LAP-HP-THINKPAD-X360-1040-G8
UPDATE sku_master SET quantity_in_stock = 14 WHERE id = '6d9c0efb-98dd-4022-be17-64fdca77cc7c'; -- SKU-LAP-LENOVO-THINKPAD-L14
UPDATE sku_master SET quantity_in_stock = 1 WHERE id = '167dc23d-5139-485a-ac84-84bd077230e3'; -- SKU-LAP-LENOVO-THINKPAD-L14-GEN2
UPDATE sku_master SET quantity_in_stock = 2 WHERE id = 'a7856740-4981-462d-8622-210ea015f98c'; -- SKU-LAP-LENOVO-THINKPAD-L480
UPDATE sku_master SET quantity_in_stock = 0 WHERE id = '2bc57c2a-0c90-4035-bf74-37375d988904'; -- SKU-LAP-LENOVO-THINKPAD-P14S-001
UPDATE sku_master SET quantity_in_stock = 8 WHERE id = 'ee3c9de9-a87b-45ba-8dd3-410c8fd5ee66'; -- SKU-LAP-LENOVO-THINKPAD-T14S
UPDATE sku_master SET quantity_in_stock = 11 WHERE id = '250db698-707e-4170-861a-cf783ef9eeaf'; -- SKU-LAP-LENOVO-THINKPAD-T450
UPDATE sku_master SET quantity_in_stock = 0 WHERE id = 'b14266f8-fafb-41bb-bab8-c0c7e9b5217f'; -- SKU-LAP-LENOVO-THINKPAD-T450-001
UPDATE sku_master SET quantity_in_stock = 9 WHERE id = 'bc1b5a99-3b16-4cd2-9035-2c29edd6c978'; -- SKU-LAP-LENOVO-THINKPAD-T450-002
UPDATE sku_master SET quantity_in_stock = 3 WHERE id = '76081777-a23c-495f-9e6b-1ce41e027e73'; -- SKU-LAP-LENOVO-THINKPAD-V14
UPDATE sku_master SET quantity_in_stock = 1 WHERE id = 'f04cdee6-ffe6-459f-91ce-2f4045c45412'; -- SKU-LAP-LENOVO-THINKPAD-X390
UPDATE sku_master SET quantity_in_stock = 227 WHERE id = '06170e60-2d18-4895-a6a0-6d0ad3e40b36'; -- SKU-LAP-UNK-MODEL-001
UPDATE sku_master SET quantity_in_stock = 2 WHERE id = 'b51b811a-3974-4315-a3e6-34f77321d63a'; -- SKU-LAP-WINDOWS-MICROSOFT-SURFACE-1943
UPDATE sku_master SET quantity_in_stock = 3 WHERE id = '1eeebeb2-433e-47c3-88c5-0240b887b057'; -- SKU-MON-UNK-MODEL-e5858d0f51f34c1684d5b3964e26d6ea
UPDATE sku_master SET quantity_in_stock = 1 WHERE id = 'cd14af8e-1117-4234-a7db-178b4569f220'; -- SKU-OTHER-UNK-MODEL-349b574afc024d728d3933f0e1d5c37d
UPDATE sku_master SET quantity_in_stock = 0 WHERE id = 'de6926b9-a76f-4187-ad8d-351261cddf60'; -- SKU-RAM-CONSISTENT-8-DDR4-2666-LAPTOP-001
UPDATE sku_master SET quantity_in_stock = 0 WHERE id = '371001f8-4129-4e0f-8cb0-22a7ad9495ee'; -- SKU-RAM-CONSISTENT-UNK-001
UPDATE sku_master SET quantity_in_stock = 0 WHERE id = 'b575502e-0461-46e0-b691-069f812e8b60'; -- SKU-RAM-CONSISTENT-UNK-002
UPDATE sku_master SET quantity_in_stock = 0 WHERE id = 'f7191704-4873-42bf-b8ab-37bbb6c662ee'; -- SKU-RAM-CONSISTENT-UNK-003
UPDATE sku_master SET quantity_in_stock = 6 WHERE id = '62e3b6bc-f69d-4e03-afc2-cc83504a274b'; -- SKU-TAB-UNK-MODEL-9d57136ea3a0496b8bca4e0907089fba

-- ============================================================
-- To revert the trigger itself:
-- ============================================================
-- DROP TRIGGER IF EXISTS trg_sync_sku_stock ON public.stock_movements;
-- DROP FUNCTION IF EXISTS public.sync_sku_stock_from_movement();
