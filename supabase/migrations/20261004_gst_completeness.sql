-- Completeness worksheet: the two things that make a period un-filable because
-- something is *missing* rather than wrong -- taxed sales with no invoice, and
-- gaps in the number series. Both need reconciling against whatever system
-- actually issued the invoice (Zoho today), so this exists to be exported and
-- worked through offline.
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
  v_sales jsonb;
  v_gaps jsonb;
begin
  select coalesce(jsonb_agg(r order by r->>'sale_date', r->>'customer_name'), '[]'::jsonb)
    into v_sales
  from (
    select jsonb_build_object(
      'sale_id', s.id,
      'sale_date', s.effective_sale_date,
      'customer_name', coalesce(s.customer_name, ''),
      'customer_gstin', coalesce(c.gst_number, ''),
      'taxable_value', coalesce(s.sale_base_price, 0),
      'gst', coalesce(s.sale_gst, 0),
      'total', coalesce(s.sale_total, 0),
      'identifier', coalesce(s.asset_number, s.serial_number, ''),
      'description', coalesce(s.asset_description, s.sku, ''),
      'sold_by', coalesce(s.sold_by, ''),
      'payment_status', coalesce(s.payment_status, '')
    ) as r
    from sales s
    left join customers c on c.id = s.customer_id
    where coalesce(s.is_deleted, false) = false
      and s.invoice_id is null
      and coalesce(s.sale_type, '') = 'GST'
      and (case when lower(trim(coalesce(s.payment_account, ''))) in ('digitalbluez','techtenth','cash')
                then lower(trim(s.payment_account)) else 'digitalbluez' end) = p_entity_key
      and s.effective_sale_date between p_from and p_to
  ) t;

  -- Gaps are listed with the invoice either side, which is what makes them
  -- findable in the issuing system: the missing number sits between those two.
  select coalesce(jsonb_agg(r order by (r->>'missing_number')::bigint), '[]'::jsonb)
    into v_gaps
  from (
    select jsonb_build_object(
      'missing_number', g.missing_seq,
      'previous_invoice', (select s.invoice_number from v_gst_invoice_series s
                            where s.entity_key = g.entity_key and s.seq < g.missing_seq
                            order by s.seq desc limit 1),
      'previous_date', (select s.invoice_date from v_gst_invoice_series s
                         where s.entity_key = g.entity_key and s.seq < g.missing_seq
                         order by s.seq desc limit 1),
      'next_invoice', (select s.invoice_number from v_gst_invoice_series s
                        where s.entity_key = g.entity_key and s.seq > g.missing_seq
                        order by s.seq asc limit 1),
      'next_date', (select s.invoice_date from v_gst_invoice_series s
                     where s.entity_key = g.entity_key and s.seq > g.missing_seq
                     order by s.seq asc limit 1)
    ) as r
    from (
      select s.entity_key, generate_series(min(s.seq), max(s.seq)) as missing_seq
      from v_gst_invoice_series s
      where s.entity_key = p_entity_key and s.seq is not null
      group by s.entity_key
    ) g
    where not exists (
      select 1 from v_gst_invoice_series s3
      where s3.entity_key = g.entity_key and s3.seq = g.missing_seq
    )
      and coalesce((select s.invoice_date from v_gst_invoice_series s
                     where s.entity_key = g.entity_key and s.seq < g.missing_seq
                     order by s.seq desc limit 1), p_from) between p_from and p_to
  ) t;

  return jsonb_build_object(
    'uninvoiced_sales', v_sales,
    'series_gaps', v_gaps,
    'uninvoiced_count', jsonb_array_length(v_sales),
    'uninvoiced_tax', (select coalesce(sum((e->>'gst')::numeric), 0) from jsonb_array_elements(v_sales) e),
    'uninvoiced_taxable', (select coalesce(sum((e->>'taxable_value')::numeric), 0) from jsonb_array_elements(v_sales) e)
  );
end;
$function$;

comment on function public.gst_completeness_worksheet(text, date, date) is
  'Taxed sales with no invoice, plus number-series gaps bracketed by the invoices either side, for reconciling a period against the system that issued its invoices.';

commit;
