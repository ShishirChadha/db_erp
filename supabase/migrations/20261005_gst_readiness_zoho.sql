-- Readiness now leads with the Zoho register, because that is what actually
-- gates filing: invoices are issued there, so a period is unverified until its
-- register has been uploaded here and reconciled.
begin;

create or replace function public.gst_return_readiness(
  p_entity_key text, p_from date, p_to date
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
  v_excluded jsonb;
  v_outward jsonb;
  v_zoho jsonb;
begin
  select key, legal_name, gstin, state_code, is_gst_registered
    into v_entity from business_profiles where key = p_entity_key;

  if not found then
    return jsonb_build_object('error', 'unknown_entity');
  end if;

  if not v_entity.is_gst_registered then
    return jsonb_build_object(
      'entity', to_jsonb(v_entity), 'not_registered', true,
      'blockers', 0, 'warnings', 0, 'by_check', '[]'::jsonb
    );
  end if;

  v_zoho := gst_zoho_register_status(p_entity_key, p_from, p_to);

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

  -- Uninvoiced sales, split by whether payment has already landed. A paid one
  -- matters more: the tax point is the earlier of invoice date or payment
  -- receipt, so once paid the liability has crystallised regardless.
  select
    count(*),
    coalesce(sum(coalesce(s.sale_gst,0)), 0)
  into v_uninvoiced_count, v_uninvoiced_tax
  from sales s
  where coalesce(s.is_deleted,false) = false
    and s.invoice_id is null
    and coalesce(s.sale_type,'') = 'GST'
    and s.gst_exclusion_reason is null
    and (case when lower(trim(coalesce(s.payment_account,''))) in ('digitalbluez','techtenth','cash')
              then lower(trim(s.payment_account)) else 'digitalbluez' end) = p_entity_key
    and s.effective_sale_date between p_from and p_to;

  select jsonb_build_object(
    'count', count(*),
    'value', coalesce(sum(coalesce(s.sale_total,0)), 0),
    'awaiting_review', count(*) filter (where s.gst_exclusion_reviewed_at is null),
    'by_reason', coalesce(jsonb_object_agg(s.gst_exclusion_reason, 1) filter (where s.gst_exclusion_reason is not null), '{}'::jsonb)
  ) into v_excluded
  from sales s
  where coalesce(s.is_deleted,false) = false
    and s.gst_exclusion_reason is not null
    and (case when lower(trim(coalesce(s.payment_account,''))) in ('digitalbluez','techtenth','cash')
              then lower(trim(s.payment_account)) else 'digitalbluez' end) = p_entity_key
    and s.effective_sale_date between p_from and p_to;

  select jsonb_build_object(
           'invoices', count(distinct i.id) filter (where coalesce(i.invoice_type,'sales') = 'sales'),
           'credit_notes', count(distinct i.id) filter (where i.invoice_type = 'credit_note'),
           'taxable_value', coalesce(sum(li.quantity * li.rate
             * (case when i.invoice_type = 'credit_note' then -1 else 1 end)), 0),
           'cgst', coalesce(sum(li.cgst_amount * (case when i.invoice_type = 'credit_note' then -1 else 1 end)), 0),
           'sgst', coalesce(sum(li.sgst_amount * (case when i.invoice_type = 'credit_note' then -1 else 1 end)), 0),
           'igst', coalesce(sum(li.igst_amount * (case when i.invoice_type = 'credit_note' then -1 else 1 end)), 0)
         )
    into v_outward
  from invoices i
    join invoice_items li on li.invoice_id = i.id
  where i.entity_key = p_entity_key
    and coalesce(i.is_deleted,false) = false
    and coalesce(i.invoice_type,'sales') in ('sales','credit_note')
    and i.invoice_date between p_from and p_to;

  return jsonb_build_object(
    'entity', to_jsonb(v_entity),
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'zoho_register', v_zoho,
    'blockers', coalesce(v_blockers,0),
    'warnings', coalesce(v_warnings,0),
    'by_check', v_by_check,
    'completeness', jsonb_build_object(
      'uninvoiced_sales', coalesce(v_uninvoiced_count,0),
      'uninvoiced_tax', coalesce(v_uninvoiced_tax,0)
    ),
    'excluded', v_excluded,
    'outward', coalesce(v_outward, '{}'::jsonb),
    -- Two independent conditions: nothing outstanding, AND the period has
    -- actually been checked against Zoho. The second is the one that stops a
    -- month being filed simply because nobody looked at it.
    'can_generate', coalesce(v_blockers,0) = 0 and (v_zoho->>'reconciled')::boolean
  );
end;
$function$;

commit;
