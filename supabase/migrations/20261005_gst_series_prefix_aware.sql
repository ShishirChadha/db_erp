-- Make number-series handling prefix-aware.
--
-- Digitalbluez is configured with invoice_prefix 'DB' while every invoice so
-- far is Zoho's 'DBI' series, so once the ERP starts issuing, two series will
-- coexist in one financial year. That is legal -- Rule 46 requires each series
-- to be consecutive and unique within the year, not that there be only one --
-- but it breaks anything that treats the numeric suffix as a single sequence.
--
-- Before this, gap detection parsed suffixes across all invoices at once, so
-- DBI...00751 followed by DB...00681 would read as a 70-number gap plus a
-- duplicate. Table 13 likewise has to report one row per series.
begin;

-- v_gst_exceptions reads this view, and a column is being added mid-list while
-- the row set changes (cancelled invoices are now included), so both are
-- dropped in dependency order and recreated. Never CASCADE: the exceptions view
-- is recreated explicitly below by re-running its own migration.
drop view if exists public.v_gst_exceptions;
drop view if exists public.v_gst_invoice_series;

create view public.v_gst_invoice_series as
select
  i.id,
  i.entity_key,
  i.invoice_number,
  i.invoice_date,
  coalesce(i.is_deleted, false) as cancelled,
  date_trunc('month', i.invoice_date)::date as period_month,
  -- The series this number belongs to, as written: everything before the
  -- trailing digits. Used for display only.
  regexp_replace(i.invoice_number, '[0-9]+\s*$', '') as series_prefix,
  -- Grouping key for the same thing, with punctuation and case stripped.
  -- 'DBI2026/27-' and the mistyped 'DBI2026/27--' both collapse to 'DBI202627',
  -- so a typo stays inside its real series instead of becoming a second one --
  -- which would otherwise make Table 13 report two series, one of them bogus.
  -- 'DB2026/27-' collapses to 'DB202627', genuinely distinct.
  upper(regexp_replace(regexp_replace(i.invoice_number, '[0-9]+\s*$', ''), '[^A-Za-z0-9]', '', 'g')) as series_key,
  -- Everything after the last non-digit. Tolerates the malformed
  -- double-hyphen number present in this data.
  nullif(regexp_replace(i.invoice_number, '^.*[^0-9]', ''), '')::bigint as seq,
  -- Credit notes are a separate document nature in Table 13 (5, not 1) and get
  -- their own series, so the kind has to travel with the row.
  coalesce(i.invoice_type, 'sales') as doc_type
from invoices i
where coalesce(i.invoice_type, 'sales') in ('sales', 'credit_note');

comment on view public.v_gst_invoice_series is
  'Invoice numbers split into series prefix and sequence, so gap detection and Table 13 work correctly when more than one series exists in a financial year. Includes cancelled (soft-deleted) invoices, because a cancelled number is still accounted for.';

-- Table 13, one row per series. A soft-deleted invoice is a CANCELLED document
-- here, not a nonexistent one -- leaving it out makes the table unreconcilable
-- against the numbers actually consumed.
create or replace function public.gst_r1_docs_issued(
  p_entity_key text, p_from date, p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v jsonb;
begin
  select coalesce(jsonb_agg(r order by r->>'from'), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      -- 1 = "Invoices for outward supply" in the portal's document-nature list.
      'doc_num', 1,
      'doc_typ', 'Invoices for outward supply',
      'series', (array_agg(s.series_prefix order by s.seq))[1],
      'from', (array_agg(s.invoice_number order by s.seq))[1],
      'to', (array_agg(s.invoice_number order by s.seq desc))[1],
      'totnum', count(*),
      'cancel', count(*) filter (where s.cancelled),
      'net_issue', count(*) - count(*) filter (where s.cancelled)
    ) as r
    from v_gst_invoice_series s
    where s.entity_key = p_entity_key
      and s.invoice_date between p_from and p_to
      and s.seq is not null
    group by s.series_key
  ) t;

  return jsonb_build_object('doc_det', coalesce(v, '[]'::jsonb));
end;
$function$;

commit;
