-- September classifications, confirmed by the owner.
-- Reversal value: SKU-ACC-WIFI-DONGLE-001 hsn_code was '' (empty string).
--
-- A USB WiFi dongle is a network communication device -- 8517 62 90, "machines
-- for the reception, conversion and transmission of voice, images or other
-- data". 18% either way, so this affects only which Table 12 row it lands in,
-- not the tax.
begin;

update sku_master
set hsn_code = '85176290'
where full_sku_code = 'SKU-ACC-WIFI-DONGLE-001'
  and coalesce(nullif(trim(hsn_code), ''), '') = '';

commit;
