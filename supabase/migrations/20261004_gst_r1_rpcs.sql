begin;

-- GSTR-1 working papers. Returns FLAT rows per section -- directly usable as
-- one CSV per section, and the same aggregation the Phase 4 JSON writer will
-- nest into the portal's grouped shape. One aggregation, two transports.
create or replace function public.gst_r1_sections(
  p_entity_key text, p_from date, p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_b2b jsonb; v_b2cl jsonb; v_b2cs jsonb;
begin
  -- B2B (Table 4A): invoice x rate, grouped under the recipient GSTIN.
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
      and gstr1_section = 'b2b'
    group by customer_gstin, customer_name, invoice_number, invoice_date, pos, rt
  ) t;

  -- B2CL (Table 5A): unregistered, inter-state, over the date-aware threshold.
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
      and gstr1_section = 'b2cl'
    group by pos, invoice_number, invoice_date, rt
  ) t;

  -- B2CS (Table 7): fully consolidated, no invoice detail at all.
  select coalesce(jsonb_agg(r order by r->>'sply_ty', r->>'pos', (r->>'rt')::numeric), '[]'::jsonb)
    into v_b2cs
  from (
    select jsonb_build_object(
      'sply_ty', sply_ty, 'typ', 'OE', 'pos', pos, 'rt', rt,
      'txval', round(sum(txval), 2),
      'camt', round(sum(camt), 2), 'samt', round(sum(samt), 2),
      'iamt', round(sum(iamt), 2), 'csamt', round(sum(csamt), 2)
    ) as r
    from v_gst_outward_lines
    where entity_key = p_entity_key and invoice_date between p_from and p_to
      and gstr1_section = 'b2cs'
    group by sply_ty, pos, rt
  ) t;

  return jsonb_build_object('b2b', v_b2b, 'b2cl', v_b2cl, 'b2cs', v_b2cs);
end;
$function$;

-- Table 12. Split into hsn_b2b / hsn_b2c, which is the shape the portal has
-- required since the May 2025 return period; the old single list is legacy.
create or replace function public.gst_r1_hsn_summary(
  p_entity_key text, p_from date, p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_b2b jsonb; v_b2c jsonb;
begin
  with rows_all as (
    select
      is_b2b,
      hsn_code as hsn_sc,
      -- Portal caps the description at 30 characters.
      left(max(description), 30) as descr,
      -- No UQC on sku_master; goods are counted in numbers here, services
      -- take OTH. Revisit if a category is ever sold by weight or length.
      case when bool_and(is_service) then 'OTH-OTHERS' else 'NOS-NUMBERS' end as uqc,
      round(sum(quantity), 2) as qty,
      rt,
      round(sum(txval), 2) as txval,
      round(sum(iamt), 2) as iamt,
      round(sum(camt), 2) as camt,
      round(sum(samt), 2) as samt,
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

-- Table 13. Generated from the number series rather than hand-typed (Zoho
-- makes you type from/to/total/cancelled by hand, which is both tedious and a
-- correctness hole). A soft-deleted invoice is a CANCELLED document here, not
-- a nonexistent one -- leaving it out makes the table unreconcilable.
create or replace function public.gst_r1_docs_issued(
  p_entity_key text, p_from date, p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  with all_inv as (
    select
      i.invoice_number,
      coalesce(i.is_deleted, false) as cancelled,
      nullif(regexp_replace(i.invoice_number, '^.*[^0-9]', ''), '')::bigint as seq
    from invoices i
    where i.entity_key = p_entity_key
      and coalesce(i.invoice_type, 'sales') = 'sales'
      and i.invoice_date between p_from and p_to
  ),
  agg as (
    select
      (select invoice_number from all_inv where seq = (select min(seq) from all_inv)) as from_num,
      (select invoice_number from all_inv where seq = (select max(seq) from all_inv)) as to_num,
      count(*) as totnum,
      count(*) filter (where cancelled) as cancel
    from all_inv
  )
  select case when a.totnum = 0 then '[]'::jsonb else
    jsonb_build_array(jsonb_build_object(
      -- 1 = "Invoices for outward supply" in the portal's document-nature list.
      'doc_num', 1, 'doc_typ', 'Invoices for outward supply',
      'from', a.from_num, 'to', a.to_num,
      'totnum', a.totnum, 'cancel', a.cancel,
      'net_issue', a.totnum - a.cancel
    )) end
  into v from agg a;

  return jsonb_build_object('doc_det', coalesce(v, '[]'::jsonb));
end;
$function$;

comment on function public.gst_r1_sections(text, date, date) is
  'GSTR-1 Tables 4A/5A/7 as flat rows per section, keyed on invoice_date. Reused by both the CSV export and the portal JSON writer.';
comment on function public.gst_r1_hsn_summary(text, date, date) is
  'GSTR-1 Table 12, split into hsn_b2b/hsn_b2c as required from the May 2025 return period.';
comment on function public.gst_r1_docs_issued(text, date, date) is
  'GSTR-1 Table 13, derived from the invoice number series. Soft-deleted invoices count as cancelled documents.';

commit;
