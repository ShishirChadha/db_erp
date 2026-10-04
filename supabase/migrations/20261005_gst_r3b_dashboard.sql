begin;

-- ---------------------------------------------------------------------------
-- GSTR-3B. Outward tables are hard-locked and auto-populated from GSTR-1 since
-- the July 2025 period, so these figures exist to be KEYED IN and RECONCILED
-- against what the portal fills -- never as an overriding input. Table 4 comes
-- from the ITC tagging, not from raw purchase rows, so a late claim or a
-- reversal is representable.
-- ---------------------------------------------------------------------------
create or replace function public.gst_r3b_summary(
  p_entity_key text, p_from date, p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_taxable numeric; v_c numeric; v_s numeric; v_i numeric;
  v_nil numeric;
  v_rcm jsonb; v_32 jsonb; v_itc jsonb; v_t5 jsonb;
  v_entity record;
begin
  select key, legal_name, gstin, state_code, is_gst_registered
    into v_entity from business_profiles where key = p_entity_key;
  if not found then return jsonb_build_object('error','unknown_entity'); end if;
  if not v_entity.is_gst_registered then
    return jsonb_build_object('entity', to_jsonb(v_entity), 'not_registered', true);
  end if;

  -- 3.1(a) outward taxable (other than zero-rated, nil-rated, exempt)
  select coalesce(sum(txval),0), coalesce(sum(camt),0), coalesce(sum(samt),0), coalesce(sum(iamt),0)
    into v_taxable, v_c, v_s, v_i
  from v_gst_outward_lines
  where entity_key = p_entity_key and invoice_date between p_from and p_to and rt > 0;

  -- 3.1(c) nil-rated / exempt
  select coalesce(sum(txval),0) into v_nil
  from v_gst_outward_lines
  where entity_key = p_entity_key and invoice_date between p_from and p_to and coalesce(rt,0) = 0;

  -- 3.1(d) inward supplies liable to reverse charge. Import of services is the
  -- one that bites an SMB (foreign advertising/cloud) and is explicitly NOT
  -- auto-populated by the portal, so it stays our responsibility.
  select jsonb_build_object(
    'taxable_value', coalesce(sum(e.amount),0),
    'tax', coalesce(sum(e.gst_amount),0),
    'import_of_services_taxable', coalesce(sum(e.amount) filter (where e.supply_type = 'rcm_import_services'),0),
    'import_of_services_tax', coalesce(sum(e.gst_amount) filter (where e.supply_type = 'rcm_import_services'),0),
    'domestic_taxable', coalesce(sum(e.amount) filter (where e.supply_type = 'rcm_domestic'),0),
    'domestic_tax', coalesce(sum(e.gst_amount) filter (where e.supply_type = 'rcm_domestic'),0),
    'rows', count(*)
  ) into v_rcm
  from expenses e
  where coalesce(e.entity_key, 'digitalbluez') = p_entity_key
    and e.supply_type in ('rcm_domestic','rcm_import_services')
    and e.expense_date between p_from and p_to;

  -- 3.2 inter-state supplies to unregistered persons
  select coalesce(jsonb_agg(r order by r->>'pos'), '[]'::jsonb) into v_32
  from (
    select jsonb_build_object('pos', pos, 'taxable_value', round(sum(txval),2), 'igst', round(sum(iamt),2)) as r
    from v_gst_outward_lines
    where entity_key = p_entity_key and invoice_date between p_from and p_to
      and not is_b2b and not is_intra_state
    group by pos
  ) t;

  -- Table 4: from the ITC tagging. A line counts in the period it was CLAIMED
  -- in when that is set, else the vendor invoice date (the ITC period), else
  -- the PO date as a last resort for legacy rows.
  with itc as (
    select poi.itc_status,
           coalesce(poi.cgst_amount,0) c, coalesce(poi.sgst_amount,0) s, coalesce(poi.igst_amount,0) i,
           coalesce(poi.itc_claimed_period, po.vendor_invoice_date, po.po_date) as eff_date
    from purchase_order_items poi
      join purchase_orders po on po.id = poi.po_id
    where coalesce(po.is_deleted,false) = false
      and (case when lower(trim(coalesce(po.purchased_by_type,''))) in ('digitalbluez','techtenth','cash')
                then lower(trim(po.purchased_by_type)) else 'digitalbluez' end) = p_entity_key
  )
  select jsonb_build_object(
    '4A_all_other_itc', jsonb_build_object(
      'cgst', coalesce(sum(c) filter (where itc_status = 'claimed'),0),
      'sgst', coalesce(sum(s) filter (where itc_status = 'claimed'),0),
      'igst', coalesce(sum(i) filter (where itc_status = 'claimed'),0)),
    '4B_reversed', jsonb_build_object(
      'cgst', coalesce(sum(c) filter (where itc_status = 'reversed'),0),
      'sgst', coalesce(sum(s) filter (where itc_status = 'reversed'),0),
      'igst', coalesce(sum(i) filter (where itc_status = 'reversed'),0)),
    '4D_ineligible', jsonb_build_object(
      'cgst', coalesce(sum(c) filter (where itc_status = 'ineligible'),0),
      'sgst', coalesce(sum(s) filter (where itc_status = 'ineligible'),0),
      'igst', coalesce(sum(i) filter (where itc_status = 'ineligible'),0)),
    'pending_not_yet_claimed', jsonb_build_object(
      'cgst', coalesce(sum(c) filter (where itc_status = 'pending'),0),
      'sgst', coalesce(sum(s) filter (where itc_status = 'pending'),0),
      'igst', coalesce(sum(i) filter (where itc_status = 'pending'),0))
  ) into v_itc
  from itc where eff_date between p_from and p_to;

  -- Table 5: exempt / nil / non-GST inward
  select jsonb_build_object(
    'exempt_or_nil', coalesce(sum(e.amount) filter (where e.supply_type in ('none','forward') and coalesce(e.gst_amount,0) = 0),0),
    'rows', count(*)
  ) into v_t5
  from expenses e
  where coalesce(e.entity_key,'digitalbluez') = p_entity_key
    and e.expense_date between p_from and p_to;

  return jsonb_build_object(
    'entity', to_jsonb(v_entity),
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'table_3_1', jsonb_build_object(
      'a_outward_taxable', jsonb_build_object(
        'taxable_value', round(v_taxable,2), 'cgst', round(v_c,2),
        'sgst', round(v_s,2), 'igst', round(v_i,2), 'cess', 0),
      'b_zero_rated', jsonb_build_object('taxable_value', 0, 'igst', 0),
      'c_nil_exempt', jsonb_build_object('taxable_value', round(v_nil,2)),
      'd_inward_reverse_charge', v_rcm,
      'e_non_gst_outward', jsonb_build_object('taxable_value', 0)),
    'table_3_2_interstate_unregistered', v_32,
    'table_4_itc', v_itc,
    'table_5_exempt_inward', v_t5,
    -- Interest and late fee are human judgement; the portal has its own
    -- calculator and the taxpayer can override it.
    'table_5_1_interest_late_fee', jsonb_build_object('owner_entered', true),
    'caveat', 'Outward tables are auto-populated from GSTR-1 at the portal and have been non-editable since the July 2025 period. Table 4 here is computed from ITC tagging in this ERP and will not match GSTR-2B unless the purchase register has been reconciled against it. Use these to verify and reconcile, not to overwrite.'
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Books vs return. BUSY's "Reconcile Accounts & GST", and nearly free here
-- because both sides come off the same sales data. Any divergence is a bug in
-- the pipeline or an outstanding exception.
-- ---------------------------------------------------------------------------
create or replace function public.gst_books_vs_return(
  p_entity_key text, p_from date, p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_books jsonb; v_return jsonb; v_t12 numeric;
begin
  -- Books: every taxed sale in the period, invoiced or not.
  select jsonb_build_object(
    'sales', count(*),
    'taxable_value', coalesce(sum(s.sale_base_price),0),
    'tax', coalesce(sum(s.sale_gst),0),
    'total', coalesce(sum(s.sale_total),0)
  ) into v_books
  from sales s
  where coalesce(s.is_deleted,false) = false
    and coalesce(s.sale_type,'') = 'GST'
    and (case when lower(trim(coalesce(s.payment_account,''))) in ('digitalbluez','techtenth','cash')
              then lower(trim(s.payment_account)) else 'digitalbluez' end) = p_entity_key
    and s.effective_sale_date between p_from and p_to;

  -- Return: what GSTR-1 would actually carry.
  select jsonb_build_object(
    'invoices', count(distinct invoice_id),
    'lines', count(*),
    'taxable_value', coalesce(sum(txval),0),
    'tax', coalesce(sum(camt + samt + iamt),0)
  ) into v_return
  from v_gst_outward_lines
  where entity_key = p_entity_key and invoice_date between p_from and p_to;

  select coalesce(sum(txval),0) into v_t12
  from v_gst_outward_lines
  where entity_key = p_entity_key and invoice_date between p_from and p_to
    and hsn_code is not null;

  return jsonb_build_object(
    'books', v_books,
    'return', v_return,
    'table_12_taxable_value', round(v_t12,2),
    'taxable_difference', round((v_return->>'taxable_value')::numeric - (v_books->>'taxable_value')::numeric, 2),
    'tax_difference', round((v_return->>'tax')::numeric - (v_books->>'tax')::numeric, 2),
    'table_12_difference', round((v_return->>'taxable_value')::numeric - v_t12, 2),
    -- Books are keyed on sale date and the return on invoice date, so a sale
    -- invoiced in the next month legitimately differs. A difference is a
    -- prompt to look, not proof of a bug.
    'note', 'Books are keyed on sale date, the return on invoice date. A sale invoiced in a later month shows here as a difference and is not necessarily an error. Table 12 must match the return exactly -- the portal cross-validates it.'
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Returns dashboard: one row per period per return type, with filing state and
-- the three-year filing bar (enforced on the portal since 1 Oct 2025 -- after
-- three years past the due date a return cannot be filed at all, with no
-- condonation, and the liability survives).
-- ---------------------------------------------------------------------------
create or replace function public.gst_returns_dashboard(
  p_entity_key text, p_months int default 12
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v jsonb;
begin
  select coalesce(jsonb_agg(r order by r->>'period_start' desc, r->>'return_type'), '[]'::jsonb)
    into v
  from (
    select jsonb_build_object(
      'period_start', p.period_start,
      'period_end', (p.period_start + interval '1 month - 1 day')::date,
      'return_type', rt.return_type,
      'status', coalesce(f.status, 'not_started'),
      'arn', f.arn,
      'filed_at', f.filed_at,
      -- GSTR-1 is due the 11th of the following month, 3B the 20th.
      'due_date', (p.period_start + interval '1 month'
                   + (case when rt.return_type = 'gstr1' then 10 else 19 end || ' days')::interval)::date,
      'days_overdue', greatest(0, current_date - (p.period_start + interval '1 month'
                   + (case when rt.return_type = 'gstr1' then 10 else 19 end || ' days')::interval)::date),
      'bar_date', (p.period_start + interval '1 month'
                   + (case when rt.return_type = 'gstr1' then 10 else 19 end || ' days')::interval
                   + interval '3 years')::date,
      'days_until_barred', (p.period_start + interval '1 month'
                   + (case when rt.return_type = 'gstr1' then 10 else 19 end || ' days')::interval
                   + interval '3 years')::date - current_date,
      'blockers', (select count(*) from v_gst_exceptions x
                    where x.entity_key = p_entity_key and x.severity = 'blocker'
                      and (x.period_month is null or x.period_month = p.period_start))
    ) as r
    from (
      select (date_trunc('month', current_date) - (n || ' months')::interval)::date as period_start
      from generate_series(0, greatest(p_months, 1) - 1) n
    ) p
    cross join (values ('gstr1'), ('gstr3b')) as rt(return_type)
    left join gst_filings f
      on f.entity_key = p_entity_key and f.return_type = rt.return_type
     and f.period_start = p.period_start
  ) t;

  return jsonb_build_object('rows', v);
end;
$function$;

commit;
