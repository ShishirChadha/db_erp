-- Backup taken 2026-07-21, before Phase 0 / Step 1 (asset-numbering consolidation)
-- of the purchase-module unification plan.
-- Source: live Supabase project queried via mcp__supabase__execute_sql.
-- Purpose: restore point for the objects being dropped/replaced in this step:
--   functions: get_next_asset_number, next_asset_number_int, next_asset_numbers_int, generate_vendor_code
--   table: counters (1 row)
--   table: asset_sequences (1 row)
--   sequence: asset_number_seq (last_value 587)
-- None of these are referenced by any live code path (verified via grep across app/, lib/,
-- components/ and via pg_trigger — only vendors_vendor_code trigger uses generate_vendor_code,
-- which is being replaced, not dropped outright).

-- ============================================================
-- 1. Function definitions (exact CREATE OR REPLACE to restore)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_next_asset_number()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  next_val integer;
begin
  update counters set value = value + 1 where id = 'asset_number'
  returning value into next_val;
  return 'DB-' || to_char(now(), 'YYYY') || '-' || lpad(next_val::text, 4, '0');
end;
$function$;

CREATE OR REPLACE FUNCTION public.next_asset_number_int()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN nextval('asset_number_seq');
END;
$function$;

CREATE OR REPLACE FUNCTION public.next_asset_numbers_int(count integer)
 RETURNS integer[]
 LANGUAGE plpgsql
AS $function$
DECLARE
  result INTEGER[];
  i INTEGER;
BEGIN
  FOR i IN 1..count LOOP
    result := array_append(result, nextval('asset_number_seq'));
  END LOOP;
  RETURN result;
END;
$function$;

-- Original (MAX-scan, race-prone) version of generate_vendor_code, being replaced
-- in this same step by a sequence-backed version. Restore this exact body to revert.
CREATE OR REPLACE FUNCTION public.generate_vendor_code()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  next_num INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(vendor_code FROM 6) AS INT)), 0) + 1 INTO next_num
  FROM vendors WHERE vendor_code LIKE 'VEND-%';
  NEW.vendor_code := 'VEND-' || LPAD(next_num::TEXT, 4, '0');
  RETURN NEW;
END;
$function$;

-- Trigger that attaches generate_vendor_code (unchanged by this step, listed for completeness)
-- CREATE TRIGGER vendors_vendor_code BEFORE INSERT ON public.vendors
--   FOR EACH ROW WHEN ((new.vendor_code IS NULL)) EXECUTE FUNCTION generate_vendor_code();

-- ============================================================
-- 2. Table data (to recreate + repopulate if needed)
-- ============================================================

-- counters (public.counters) -- 1 row, RLS disabled
-- Columns: id text, value integer
CREATE TABLE IF NOT EXISTS public.counters (
  id text PRIMARY KEY,
  value integer
);
INSERT INTO public.counters (id, value) VALUES ('asset_number', 12)
ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value;

-- asset_sequences (public.asset_sequences) -- 1 row, RLS disabled
-- Columns: id uuid, prefix text, last_number integer
CREATE TABLE IF NOT EXISTS public.asset_sequences (
  id uuid PRIMARY KEY,
  prefix text,
  last_number integer
);
INSERT INTO public.asset_sequences (id, prefix, last_number)
VALUES ('3bb8d2b9-800a-4c31-81d6-6c800e30c84e', 'DBAS', 1)
ON CONFLICT (id) DO UPDATE SET prefix = EXCLUDED.prefix, last_number = EXCLUDED.last_number;

-- ============================================================
-- 3. Sequence (to recreate at the same position if needed)
-- ============================================================

-- asset_number_seq last_value was 587 at backup time.
CREATE SEQUENCE IF NOT EXISTS public.asset_number_seq;
SELECT setval('public.asset_number_seq', 587, true);
