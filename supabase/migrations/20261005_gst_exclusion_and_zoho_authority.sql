-- Two changes that follow from how invoicing actually works here.
--
-- 1. SOME SALES WILL NEVER BE INVOICED. A sample, a gift, a warranty
--    replacement or a demo unit leaves stock but produces no tax invoice, and
--    until now the GST module treated every such sale as a missing invoice and
--    blocked the return on it.
--
--    Note what this does NOT mean: a gift or free sample is not simply outside
--    GST. No output tax arises (there is no consideration), but s.17(5)(h)
--    BLOCKS the input credit on goods "disposed of by way of gift or free
--    samples", so the credit claimed when that unit was bought has to be
--    reversed. Marking a sale excluded therefore creates an ITC obligation
--    rather than removing one, and the checks below raise it.
--
-- 2. ZOHO IS THE AUTHORITY FOR WHAT WAS INVOICED. Invoices are issued in Zoho,
--    not here, so "this sale has no invoice_id in the ERP" is the wrong
--    question -- it measures this system's recording backlog, not a tax gap.
--    Filing readiness now depends on the period's Zoho register being uploaded
--    and reconciling, and an uninvoiced sale drops from blocker to warning.

begin;

-- ---------------------------------------------------------------------------
-- 1. GST exclusion on a sale.
-- ---------------------------------------------------------------------------
alter table sales add column if not exists gst_exclusion_reason text;
alter table sales add column if not exists gst_exclusion_note text;
alter table sales add column if not exists gst_excluded_by uuid references auth.users(id);
alter table sales add column if not exists gst_excluded_at timestamptz;
-- Owner sign-off. Separate from the exclusion itself so staff can record what
-- they know at entry while the tax base still gets reviewed before filing.
alter table sales add column if not exists gst_exclusion_reviewed_by uuid references auth.users(id);
alter table sales add column if not exists gst_exclusion_reviewed_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sales_gst_exclusion_reason_check') then
    alter table sales add constraint sales_gst_exclusion_reason_check
      check (gst_exclusion_reason is null or gst_exclusion_reason in (
        'sample', 'gift', 'warranty_replacement', 'internal_use', 'other'
      ));
  end if;
  -- 'other' without an explanation is not reviewable, so it has to carry one.
  if not exists (select 1 from pg_constraint where conname = 'sales_gst_exclusion_note_check') then
    alter table sales add constraint sales_gst_exclusion_note_check
      check (gst_exclusion_reason is distinct from 'other'
             or nullif(trim(coalesce(gst_exclusion_note, '')), '') is not null);
  end if;
end $$;

comment on column sales.gst_exclusion_reason is
  'Set when this sale will never produce a tax invoice: sample, gift, warranty_replacement, internal_use, other. Excludes it from the return''s completeness expectations. For sample/gift this also triggers an s.17(5)(h) ITC reversal on the unit -- the credit is blocked on goods disposed of as gifts or free samples.';
comment on column sales.gst_exclusion_reviewed_at is
  'Owner sign-off. An exclusion removes value from the GST base, so staff can record it at entry but it is surfaced for review before the period is filed.';

create index if not exists sales_gst_exclusion_idx on sales (gst_exclusion_reason)
  where gst_exclusion_reason is not null;

-- ---------------------------------------------------------------------------
-- 2. Does this period have a reconciled Zoho register?
--    A register counts only if it covers the whole period -- a partial upload
--    would silently verify part of a month and look clean.
-- ---------------------------------------------------------------------------
create or replace function public.gst_zoho_register_status(
  p_entity_key text, p_from date, p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_import record;
  v_unresolved int;
  v_missing int;
  v_mismatch int;
begin
  select * into v_import
  from gst_recon_imports i
  where i.entity_key = p_entity_key
    and i.kind = 'zoho_invoices'
    and i.period_start <= p_from
    and i.period_end >= p_to
  order by i.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'uploaded', false,
      'reconciled', false,
      'reason', 'No Zoho invoice register has been uploaded covering this period, so there is nothing to check the return against.'
    );
  end if;

  -- An unresolved row is one nobody has decided about yet. A resolved one is a
  -- judgement already recorded, so it stops blocking.
  select
    count(*) filter (where l.match_status = 'missing_in_erp' and l.resolution is null),
    count(*) filter (where l.match_status = 'value_mismatch' and l.resolution is null)
  into v_missing, v_mismatch
  from gst_recon_lines l
  where l.import_id = v_import.id;

  v_unresolved := coalesce(v_missing, 0) + coalesce(v_mismatch, 0);

  return jsonb_build_object(
    'uploaded', true,
    'import_id', v_import.id,
    'uploaded_at', v_import.created_at,
    'source_filename', v_import.source_filename,
    'row_count', v_import.row_count,
    'matched_count', v_import.matched_count,
    'missing_in_erp_unresolved', coalesce(v_missing, 0),
    'value_mismatch_unresolved', coalesce(v_mismatch, 0),
    'reconciled', v_unresolved = 0,
    'reason', case when v_unresolved = 0 then null else
      coalesce(v_missing, 0) || ' invoice(s) in the Zoho register are not recorded here and ' ||
      coalesce(v_mismatch, 0) || ' disagree on value. Record or resolve them before filing.' end
  );
end;
$function$;

comment on function public.gst_zoho_register_status(text, date, date) is
  'Whether the period has a Zoho invoice register uploaded that fully covers it, and whether every row has been matched or explicitly resolved. Filing readiness depends on this because invoices are issued in Zoho, not here.';

commit;
