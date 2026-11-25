-- Auto Check for Macs: add the Mac-only QC items to the LAP / DES lists.
-- Labels must stay identical to CHECKS in apps/erp/lib/qc-agent/checklist.ts.
-- The unit page's manual QC form shows only the items for the unit's platform
-- (Apple -> Mac items, others -> Windows items), so these never appear on a
-- Windows laptop. Data-only; appends each label once (re-runnable).

begin;

update sku_category_templates t
set qc_checklist = t.qc_checklist || (
  select coalesce(jsonb_agg(l), '[]'::jsonb)
  from jsonb_array_elements_text('["No Activation Lock (Find My off)", "No firmware password", "Disk not encrypted (FileVault off)", "Screen coating not peeling", "Touch Bar", "Touch ID fingerprint sensor"]'::jsonb) l
  where not (t.qc_checklist ? l)
)
where category = 'LAP';

update sku_category_templates t
set qc_checklist = t.qc_checklist || (
  select coalesce(jsonb_agg(l), '[]'::jsonb)
  from jsonb_array_elements_text('["No Activation Lock (Find My off)", "No firmware password", "Disk not encrypted (FileVault off)"]'::jsonb) l
  where not (t.qc_checklist ? l)
)
where category = 'DES';

commit;
