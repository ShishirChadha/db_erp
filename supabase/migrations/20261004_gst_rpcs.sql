begin;

-- Readiness + exception summary for one entity and period.
-- Aggregation stays in SQL, per the rule in app/api/reports/route.ts.
create or replace function public.gst_return_readiness(
  p_entity_key text,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_entity record;
  v_by_check jsonb;
  v_blockers int;
  v_warnings int;
  v_uninvoiced_count int;
  v_uninvoiced_tax numeric;
  v_outward jsonb;
begin
  select key, legal_name, gstin, state_code, is_gst_registered
    into v_entity from business_profiles where key = p_entity_key;

  if not found then
    return jsonb_build_object('error', 'unknown_entity');
  end if;

  -- A return only exists for a registered entity. Techtenth/Cash are not
  -- filed and must never be presented as if they were.
  if not v_entity.is_gst_registered then
    return jsonb_build_object(
      'entity', to_jsonb(v_entity),
      'not_registered', true,
      'blockers', 0, 'warnings', 0,
      'by_check', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(r order by r->>'severity' desc, (r->>'n')::int desc), '[]'::jsonb)
    into v_by_check
  from (
    select jsonb_build_object(
             'check_code', check_code, 'check_group', check_group,
             'severity', severity, 'n', count(*)
           ) as r
    from v_gst_exceptions
    where entity_key = p_entity_key
      and (period_month is null or period_month between date_trunc('month', p_from)::date and p_to)
    group by check_code, check_group, severity
  ) t;

  select
    count(*) filter (where severity = 'blocker'),
    count(*) filter (where severity = 'warning')
  into v_blockers, v_warnings
  from v_gst_exceptions
  where entity_key = p_entity_key
    and (period_month is null or period_month between date_trunc('month', p_from)::date and p_to);

  -- Completeness is called out separately: it is the one failure that makes a
  -- return quietly under-report rather than be rejected outright.
  select count(*), coalesce(sum(coalesce(s.sale_gst,0)), 0)
    into v_uninvoiced_count, v_uninvoiced_tax
  from sales s
  where coalesce(s.is_deleted,false) = false
    and s.invoice_id is null
    and coalesce(s.sale_type,'') = 'GST'
    and (case when lower(trim(coalesce(s.payment_account,''))) in ('digitalbluez','techtenth','cash')
              then lower(trim(s.payment_account)) else 'digitalbluez' end) = p_entity_key
    and s.effective_sale_date between p_from and p_to;

  select jsonb_build_object(
           'invoices', count(distinct i.id),
           'taxable_value', coalesce(sum(li.quantity * li.rate), 0),
           'cgst', coalesce(sum(li.cgst_amount), 0),
           'sgst', coalesce(sum(li.sgst_amount), 0),
           'igst', coalesce(sum(li.igst_amount), 0)
         )
    into v_outward
  from invoices i
    join invoice_items li on li.invoice_id = i.id
  where i.entity_key = p_entity_key
    and coalesce(i.is_deleted,false) = false
    and coalesce(i.invoice_type,'sales') = 'sales'
    and i.invoice_date between p_from and p_to;

  return jsonb_build_object(
    'entity', to_jsonb(v_entity),
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'blockers', coalesce(v_blockers,0),
    'warnings', coalesce(v_warnings,0),
    'by_check', v_by_check,
    'completeness', jsonb_build_object(
      'uninvoiced_sales', coalesce(v_uninvoiced_count,0),
      'uninvoiced_tax', coalesce(v_uninvoiced_tax,0)
    ),
    'outward', coalesce(v_outward, '{}'::jsonb),
    -- The owner's decision: never generate a return for a period the ERP
    -- cannot fully account for.
    'can_generate', coalesce(v_blockers,0) = 0
  );
end;
$function$;

comment on function public.gst_return_readiness(text, date, date) is
  'GST return readiness for one entity and period: exception counts by check, completeness (uninvoiced taxed sales), outward tax totals, and whether generation is permitted.';

commit;
