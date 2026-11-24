-- One person can run two GST-registered companies on one mobile (Cognoverse +
-- Beamstack, 2026-11-24). A duplicate is now the same mobile AND the same GSTIN
-- (blank counts as one value, so two no-GSTIN records on one mobile still clash).
-- "Same mobile, one record with a GSTIN and one without" is blocked in the app
-- (lib/customer-dedupe.ts) -- an index can't compare across rows that way.
-- Looser than the old index, so existing rows can't violate it.
create unique index if not exists customers_active_phone_gst_unique
  on public.customers (btrim(phone), upper(btrim(coalesce(gst_number, ''))))
  where is_deleted = false and phone is not null and btrim(phone) <> '';
drop index if exists public.customers_active_phone_unique;
