-- September GSTR-1 data corrections. Two unambiguous fixes only; anything
-- involving a classification judgement is left to the owner/CA.
--
-- Reversal values, recorded so this is undoable without a restore:
--   customers e2a40f1a-45b6-41ca-a46e-9b9a3eafc0b8 gst_number was ' 09AECFS4362M1ZK'
--     (leading space, 16 chars)
--   sku_master SKU-OTH-AIO-4CR-0471IN-001 hsn_code was NULL

begin;

-- 1. A GSTIN stored with a leading space is 16 characters. The portal requires
--    exactly 15 with no whitespace, so this row would be rejected. Trimming is
--    the only possible correct value -- the GSTIN itself is valid and passes
--    the check digit once trimmed.
update customers
set gst_number = trim(gst_number)
where gst_number is not null
  and gst_number <> trim(gst_number);

-- 2. "HP AIO 4CR-0471IN" is an all-in-one desktop, filed in the OTHER category
--    which has no template default. 8471 41 90 is precisely "automatic data
--    processing machines comprising in the same housing at least a CPU and an
--    input and output unit" -- an all-in-one by definition -- and matches the
--    DES template default already in use. At this turnover only 4 digits are
--    reported, and 8471 is beyond doubt for an ADP machine either way.
update sku_master
set hsn_code = '84714190'
where full_sku_code = 'SKU-OTH-AIO-4CR-0471IN-001'
  and coalesce(nullif(trim(hsn_code), ''), '') = '';

commit;
