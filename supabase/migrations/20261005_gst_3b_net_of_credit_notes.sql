-- 3B and books-vs-return must be NET of credit notes.
--
-- Both read v_gst_outward_lines, which now carries credit-note rows. They were
-- summing the UNSIGNED columns, so a credit note INCREASED reported outward
-- supply instead of reducing it -- the exact sign error the view's *_signed
-- columns exist to prevent, and which over-reports the liability.
begin;

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
  v_cn jsonb;
  v_entity record;
begin
  select key, legal_name, gstin, state_code, is_gst_registered
    into v_entity from business_profiles where key = p_entity_key;
  if not found then return jsonb_build_object('error','unknown_entity'); end if;
  if not v_entity.is_gst_registered then
    return jsonb_build_object('entity', to_jsonb(v_entity), 'not_registered', true);
  end if;

  -- 3.1(a), net of credit notes.
  select coalesce(sum(txval_signed),0), coalesce(sum(camt_signed),0),
         coalesce(sum(samt_signed),0), coalesce(sum(iamt_signed),0)
    into v_taxable, v_c, v_s, v_i
  from v_gst_outward_lines
  where entity_key = p_entity_key and invoice_date between p_from and p_to and rt > 0;

  select coalesce(sum(txval_signed),0) into v_nil
  from v_gst_outward_lines
  where entity_key = p_entity_key and invoice_date between p_from and p_to and coalesce(rt,0) = 0;

  -- Shown separately so the reduction is visible rather than just baked in.
  select jsonb_build_object(
    'count', count(distinct invoice_id),
    'taxable_value', coalesce(sum(txval),0),
    'tax', coalesce(sum(camt + samt + iamt),0)
  ) into v_cn
  from v_gst_outward_lines
  where entity_key = p_entity_key and invoice_date between p_from and p_to
    and doc_type = 'credit_note';

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

  -- 3.2 also net: a credit note to an unregistered out-of-state buyer reduces
  -- what was supplied to that state.
  select coalesce(jsonb_agg(r order by r->>'pos'), '[]'::jsonb) into v_32
  from (
    select jsonb_build_object('pos', pos,
             'taxable_value', round(sum(txval_signed),2),
             'igst', round(sum(iamt_signed),2)) as r
    from v_gst_outward_lines
    where entity_key = p_entity_key and invoice_date between p_from and p_to
      and not is_b2b and not is_intra_state
    group by pos
  ) t;

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
    'table_5_1_interest_late_fee', jsonb_build_object('owner_entered', true),
    'credit_notes_netted', v_cn,
    'caveat', 'Outward tables are auto-populated from GSTR-1 at the portal and have been non-editable since the July 2025 period. 3.1 here is net of credit notes. Table 4 is computed from ITC tagging in this ERP and will not match GSTR-2B unless the purchase register has been reconciled against it. Use these to verify and reconcile, not to overwrite.'
  );
end;
$function$;

create or replace function public.gst_books_vs_return(
  p_entity_key text, p_from date, p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_books jsonb; v_return jsonb; v_t12 numeric;
begin
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

  -- Net of credit notes, so this is comparable with the books.
  select jsonb_build_object(
    'invoices', count(distinct invoice_id) filter (where doc_type = 'sales'),
    'credit_notes', count(distinct invoice_id) filter (where doc_type = 'credit_note'),
    'lines', count(*),
    'taxable_value', coalesce(sum(txval_signed),0),
    'tax', coalesce(sum(camt_signed + samt_signed + iamt_signed),0)
  ) into v_return
  from v_gst_outward_lines
  where entity_key = p_entity_key and invoice_date between p_from and p_to;

  select coalesce(sum(txval_signed),0) into v_t12
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
    'note', 'Books are keyed on sale date, the return on invoice date, and the return is net of credit notes. A sale invoiced in a later month, or one reversed by a credit note, shows here as a difference and is not necessarily an error. Table 12 must match the return exactly -- the portal cross-validates it.'
  );
end;
$function$;

commit;
