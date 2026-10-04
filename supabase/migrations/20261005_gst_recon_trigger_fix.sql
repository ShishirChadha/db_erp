-- The bucket-count trigger was FOR EACH STATEMENT, where PL/pgSQL leaves NEW
-- and OLD null. coalesce(new.import_id, old.import_id) was therefore always
-- null, the UPDATE matched no rows, and every import silently reported
-- row_count = 0 while its lines existed and were correct.
--
-- FOR EACH ROW so the record is actually available. Line volumes here are
-- hundreds per import, so per-row is not a concern; a transition-table
-- statement trigger would be the alternative if that ever changes.
begin;

drop trigger if exists trg_sync_gst_recon_counts on gst_recon_lines;
create trigger trg_sync_gst_recon_counts
after insert or update or delete on gst_recon_lines
for each row execute function public.sync_gst_recon_counts();

-- Repair the counts on anything already imported.
update gst_recon_imports i
set row_count = l.n, matched_count = l.m, mismatch_count = l.x,
    missing_in_erp_count = l.e, missing_in_source_count = l.s
from (
  select import_id,
         count(*) n,
         count(*) filter (where match_status = 'matched') m,
         count(*) filter (where match_status = 'value_mismatch') x,
         count(*) filter (where match_status = 'missing_in_erp') e,
         count(*) filter (where match_status = 'missing_in_source') s
  from gst_recon_lines group by import_id
) l
where l.import_id = i.id;

commit;
