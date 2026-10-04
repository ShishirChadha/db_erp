begin;

-- GSTR-1 sections, now including credit notes.
-- Invoice sections read doc_type='sales'; cdnr/cdnur read 'credit_note' and use
-- the UNSIGNED amounts, because the portal expects positive values there and
-- derives the reduction itself.
create or replace function public.gst_r1_sections(
  p_entity_key text, p_from date, p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_b2b jsonb; v_b2cl jsonb; v_b2cs jsonb; v_cdnr jsonb; v_cdnur jsonb;
begin
  select coalesce(jsonb_agg(r order by r->>'ctin', r->>'inum', (r->>'rt')::numeric), '[]'::jsonb)
    into v_b2b
  from (
    select jsonb_build_object(
      'ctin', customer_gstin, 'receiver_name', customer_name,
      'inum', invoice_number, 'idt', to_char(invoice_date, 'DD-MM-YYYY'),
      'val', max(invoice_value), 'pos', pos, 'rchrg', 'N', 'inv_typ', 'R',
      'rt', rt, 'txval', round(sum(txval), 2),
      'camt', round(sum(camt), 2), 'samt', round(sum(samt), 2),
      'iamt', round(sum(iamt), 2), 'csamt', round(sum(csamt), 2)
    ) as r
    from v_gst_outward_lines
    where entity_key = p_entity_key and invoice_date between p_from and p_to
      and doc_type = 'sales' and gstr1_section = 'b2b'
    group by customer_gstin, customer_name, invoice_number, invoice_date, pos, rt
  ) t;

  select coalesce(jsonb_agg(r order by r->>'pos', r->>'inum', (r->>'rt')::numeric), '[]'::jsonb)
    into v_b2cl
  from (
    select jsonb_build_object(
      'pos', pos, 'inum', invoice_number, 'idt', to_char(invoice_date, 'DD-MM-YYYY'),
      'val', max(invoice_value), 'rt', rt, 'txval', round(sum(txval), 2),
      'iamt', round(sum(iamt), 2), 'csamt', round(sum(csamt), 2)
    ) as r
    from v_gst_outward_lines
    where entity_key = p_entity_key and invoice_date between p_from and p_to
      and doc_type = 'sales' and gstr1_section = 'b2cl'
    group by pos, invoice_number, invoice_date, rt
  ) t;

  -- B2CS is the one invoice section that is reported NET: it carries no
  -- document detail, so a B2C credit note has nowhere else to go and the
  -- portal accepts negative values here. Hence the signed columns.
  select coalesce(jsonb_agg(r order by r->>'sply_ty', r->>'pos', (r->>'rt')::numeric), '[]'::jsonb)
    into v_b2cs
  from (
    select jsonb_build_object(
      'sply_ty', sply_ty, 'typ', 'OE', 'pos', pos, 'rt', rt,
      'txval', round(sum(txval_signed), 2),
      'camt', round(sum(camt_signed), 2), 'samt', round(sum(samt_signed), 2),
      'iamt', round(sum(iamt_signed), 2), 'csamt', round(sum(csamt), 2)
    ) as r
    from v_gst_outward_lines
    where entity_key = p_entity_key and invoice_date between p_from and p_to
      and gstr1_section = 'b2cs'
      -- A registered recipient's credit note belongs in cdnr, not here.
      and (doc_type = 'sales' or not is_b2b)
    group by sply_ty, pos, rt
  ) t;

  -- Table 9B, registered recipients.
  select coalesce(jsonb_agg(r order by r->>'ctin', r->>'nt_num', (r->>'rt')::numeric), '[]'::jsonb)
    into v_cdnr
  from (
    select jsonb_build_object(
      'ctin', customer_gstin, 'receiver_name', customer_name,
      'ntty', 'C', 'nt_num', invoice_number, 'nt_dt', to_char(invoice_date, 'DD-MM-YYYY'),
      'pos', pos, 'rchrg', 'N', 'inv_typ', 'R', 'val', max(invoice_value),
      'rt', rt, 'txval', round(sum(txval), 2),
      'camt', round(sum(camt), 2), 'samt', round(sum(samt), 2),
      'iamt', round(sum(iamt), 2), 'csamt', round(sum(csamt), 2)
    ) as r
    from v_gst_outward_lines
    where entity_key = p_entity_key and invoice_date between p_from and p_to
      and doc_type = 'credit_note' and is_b2b
    group by customer_gstin, customer_name, invoice_number, invoice_date, pos, rt
  ) t;

  -- Table 9B, unregistered. typ is B2CL only for a large inter-state note;
  -- a small B2C note nets into b2cs above instead.
  select coalesce(jsonb_agg(r order by r->>'nt_num', (r->>'rt')::numeric), '[]'::jsonb)
    into v_cdnur
  from (
    select jsonb_build_object(
      'typ', 'B2CL', 'ntty', 'C',
      'nt_num', invoice_number, 'nt_dt', to_char(invoice_date, 'DD-MM-YYYY'),
      'pos', pos, 'val', max(invoice_value),
      'rt', rt, 'txval', round(sum(txval), 2),
      'iamt', round(sum(iamt), 2), 'csamt', round(sum(csamt), 2)
    ) as r
    from v_gst_outward_lines
    where entity_key = p_entity_key and invoice_date between p_from and p_to
      and doc_type = 'credit_note' and not is_b2b and gstr1_section = 'b2cl'
    group by invoice_number, invoice_date, pos, rt
  ) t;

  return jsonb_build_object(
    'b2b', v_b2b, 'b2cl', v_b2cl, 'b2cs', v_b2cs,
    'cdnr', v_cdnr, 'cdnur', v_cdnur
  );
end;
$function$;

-- Table 12 must be NET of credit notes, because the portal cross-validates it
-- against Tables 4/5/7 which are themselves net.
create or replace function public.gst_r1_hsn_summary(
  p_entity_key text, p_from date, p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_b2b jsonb; v_b2c jsonb;
begin
  with rows_all as (
    select
      is_b2b,
      hsn_code as hsn_sc,
      left(max(description), 30) as descr,
      case when bool_and(is_service) then 'OTH-OTHERS' else 'NOS-NUMBERS' end as uqc,
      round(sum(quantity * sign), 2) as qty,
      rt,
      round(sum(txval_signed), 2) as txval,
      round(sum(iamt_signed), 2) as iamt,
      round(sum(camt_signed), 2) as camt,
      round(sum(samt_signed), 2) as samt,
      round(sum(csamt), 2) as csamt
    from v_gst_outward_lines
    where entity_key = p_entity_key and invoice_date between p_from and p_to
      and hsn_code is not null
    group by is_b2b, hsn_code, rt
  )
  select
    coalesce(jsonb_agg(to_jsonb(r) - 'is_b2b' order by r.hsn_sc, r.rt) filter (where r.is_b2b), '[]'::jsonb),
    coalesce(jsonb_agg(to_jsonb(r) - 'is_b2b' order by r.hsn_sc, r.rt) filter (where not r.is_b2b), '[]'::jsonb)
  into v_b2b, v_b2c
  from rows_all r;

  return jsonb_build_object('hsn_b2b', v_b2b, 'hsn_b2c', v_b2c);
end;
$function$;

-- Table 13 gains the credit-note series as its own document nature (5).
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
  select coalesce(jsonb_agg(r order by (r->>'doc_num')::int, r->>'from'), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'doc_num', case when s.doc_type = 'credit_note' then 5 else 1 end,
      'doc_typ', case when s.doc_type = 'credit_note'
                      then 'Credit note' else 'Invoices for outward supply' end,
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
    group by s.series_key, s.doc_type
  ) t;

  return jsonb_build_object('doc_det', coalesce(v, '[]'::jsonb));
end;
$function$;

commit;
