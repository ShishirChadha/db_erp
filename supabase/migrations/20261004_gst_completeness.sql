-- Series-gaps worksheet: the one completeness question that's still an ERP
-- concern after the 2026-10-05 reset -- gaps in the invoice number series
-- (Table 13 needs every number accounted for as issued or cancelled, which is
-- a GSTN requirement unrelated to how/when a sale gets invoiced).
--
-- The uninvoiced-sales half of this worksheet was removed here: invoices are
-- issued in Zoho, not in the ERP, and a sale is deliberately left uninvoiced
-- until payment is secured, so "no invoice_id" was never something to export
-- and chase per-row. See docs/decisions.md (2026-10-05) and
-- gst_return_readiness()'s neutral completeness count.
begin;

create or replace function public.gst_completeness_worksheet(
  p_entity_key text, p_from date, p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_gaps jsonb;
begin
  -- Gaps are listed with the invoice either side, which is what makes them
  -- findable in the issuing system: the missing number sits between those two.
  -- Found WITHIN each series_key (not across all invoices), same as
  -- v_gst_exceptions's doc_series_gap -- once more than one series exists in a
  -- financial year, treating every suffix as one sequence invents gaps.
  select coalesce(jsonb_agg(r order by (r->>'missing_seq')::bigint), '[]'::jsonb)
    into v_gaps
  from (
    select jsonb_build_object(
      -- Full identifier for display (e.g. 'DBI202627724'), plus the raw
      -- numeric sequence kept separately -- concatenating series_key into
      -- missing_number itself made it non-numeric, which broke the ORDER BY
      -- cast to bigint above.
      'missing_number', g.series_key || g.missing_seq,
      'missing_seq', g.missing_seq,
      'previous_invoice', (select s.invoice_number from v_gst_invoice_series s
                            where s.entity_key = g.entity_key and s.series_key = g.series_key
                              and s.seq < g.missing_seq
                            order by s.seq desc limit 1),
      'previous_date', (select s.invoice_date from v_gst_invoice_series s
                         where s.entity_key = g.entity_key and s.series_key = g.series_key
                           and s.seq < g.missing_seq
                         order by s.seq desc limit 1),
      'next_invoice', (select s.invoice_number from v_gst_invoice_series s
                        where s.entity_key = g.entity_key and s.series_key = g.series_key
                          and s.seq > g.missing_seq
                        order by s.seq asc limit 1),
      'next_date', (select s.invoice_date from v_gst_invoice_series s
                     where s.entity_key = g.entity_key and s.series_key = g.series_key
                       and s.seq > g.missing_seq
                     order by s.seq asc limit 1)
    ) as r
    from (
      select s.entity_key, s.series_key, generate_series(min(s.seq), max(s.seq)) as missing_seq
      from v_gst_invoice_series s
      where s.entity_key = p_entity_key and s.seq is not null
      group by s.entity_key, s.series_key
    ) g
    where not exists (
      select 1 from v_gst_invoice_series s3
      where s3.entity_key = g.entity_key and s3.series_key = g.series_key
        and s3.seq = g.missing_seq
    )
      and coalesce((select s.invoice_date from v_gst_invoice_series s
                     where s.entity_key = g.entity_key and s.series_key = g.series_key
                       and s.seq < g.missing_seq
                     order by s.seq desc limit 1), p_from) between p_from and p_to
  ) t;

  return jsonb_build_object('series_gaps', v_gaps);
end;
$function$;

comment on function public.gst_completeness_worksheet(text, date, date) is
  'Invoice-number series gaps, bracketed by the invoices either side, for reconciling Table 13 against the system that issued the numbers (Zoho or the ERP).';

commit;
