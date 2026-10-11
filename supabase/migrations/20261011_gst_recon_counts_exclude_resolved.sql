-- "Problems" in Previous uploads counted every value_mismatch/missing_in_erp/
-- missing_in_source row by match_status alone, never checking whether it had
-- already been resolved -- so ignoring a row never moved the number, which
-- read as "Resolve does nothing." The trigger already re-fires on every
-- PATCH /api/gst/recon resolution (it's AFTER INSERT OR UPDATE OR DELETE),
-- so redefining the count formula here is enough going forward; existing
-- imports are backfilled once below.
begin;

create or replace function public.sync_gst_recon_counts()
returns trigger
language plpgsql
as $function$
declare v_import uuid;
begin
  v_import := coalesce(new.import_id, old.import_id);
  update gst_recon_imports i
  set row_count = (select count(*) from gst_recon_lines l where l.import_id = v_import),
      matched_count = (select count(*) from gst_recon_lines l where l.import_id = v_import and l.match_status = 'matched'),
      mismatch_count = (select count(*) from gst_recon_lines l where l.import_id = v_import and l.match_status = 'value_mismatch' and l.resolution is null),
      missing_in_erp_count = (select count(*) from gst_recon_lines l where l.import_id = v_import and l.match_status = 'missing_in_erp' and l.resolution is null),
      missing_in_source_count = (select count(*) from gst_recon_lines l where l.import_id = v_import and l.match_status = 'missing_in_source' and l.resolution is null),
      updated_at = now()
  where i.id = v_import;
  return null;
end;
$function$;

update gst_recon_imports i
set mismatch_count = l.x, missing_in_erp_count = l.e, missing_in_source_count = l.s
from (
  select import_id,
         count(*) filter (where match_status = 'value_mismatch' and resolution is null) x,
         count(*) filter (where match_status = 'missing_in_erp' and resolution is null) e,
         count(*) filter (where match_status = 'missing_in_source' and resolution is null) s
  from gst_recon_lines group by import_id
) l
where l.import_id = i.id;

commit;
