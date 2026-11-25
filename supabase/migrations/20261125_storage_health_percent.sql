-- SSD/HDD health as a number on the unit, like battery_health_percent:
-- 100 - the drive's own "life used" (wear) counter, worst internal drive.
-- Filled by Auto Check (editable on review) or typed on the manual QC form.
-- Additive, nullable: existing units stay NULL until re-tested.
alter table asset_ledger
  add column if not exists storage_health_percent smallint
  check (storage_health_percent between 0 and 100);

comment on column asset_ledger.storage_health_percent is
  'SSD/HDD health % at last QC (100 - drive wear counter, worst internal drive). Set via PUT /api/asset-ledger/[id]/qc.';
