-- Follow-up to 20261012_gst_guided_steps.sql, found by running step 9 on September:
--  * invoice lines whose gst_rate (0) disagreed with the tax charged (18%) were dropped from
--    GSTR-3B 3.1(a) into nil/exempt -> new blocker line_gst_rate_mismatch (step 2);
--  * Zoho head totals counted a Zoho document the owner had ruled out (ignored), producing a
--    false CGST/SGST gap -> excluded and shown separately as zoho_ignored_tax;
--  * step 9's message now says which figure differs.
begin;

create or replace view public.v_gst_exceptions as
with entities as (
  select key, state_code, is_gst_registered from business_profiles
),
sale_entity as (
  select s.*,
         case when lower(trim(coalesce(s.payment_account,''))) in ('digitalbluez','techtenth','cash')
              then lower(trim(s.payment_account)) else 'digitalbluez' end as entity_key
  from sales s
),
series as (select * from v_gst_invoice_series),
series_gaps as (
  select g.entity_key, g.series_key, g.missing_seq,
         (select max(s2.period_month) from series s2
           where s2.entity_key = g.entity_key and s2.series_key = g.series_key
             and s2.seq < g.missing_seq) as period_month
  from (
    select s.entity_key, s.series_key,
           generate_series(min(s.seq), max(s.seq)) as missing_seq
    from series s where s.seq is not null
    group by s.entity_key, s.series_key
  ) g
  where not exists (
    select 1 from series s3
    where s3.entity_key = g.entity_key and s3.series_key = g.series_key
      and s3.seq = g.missing_seq
  )
)

-- ========================= DOCUMENT SUMMARY =========================
select e.key as entity_key, g.period_month, 'doc_series_gap' as check_code,
       'blocker' as severity, 'document_summary' as check_group,
       'series' as record_type, null::uuid as record_id,
       (g.series_key || g.missing_seq) as record_label,
       'Invoice number ' || g.series_key || g.missing_seq || ' is missing from the series. Table 13 needs every number accounted for as either issued or cancelled -- this is either a cancelled invoice or one never recorded in the ERP.' as detail,
       g.series_key as series_key, g.missing_seq as seq
from series_gaps g join entities e on e.key = g.entity_key
where e.is_gst_registered
  and not exists (
    select 1 from gst_void_invoice_numbers v
    where v.entity_key = g.entity_key and v.series_key = g.series_key and v.seq = g.missing_seq
  )

union all
select i.entity_key, i.period_month, 'invoice_number_too_long', 'blocker', 'document_summary',
       'invoice', i.id, i.invoice_number,
       'Invoice number is ' || length(i.invoice_number) || ' characters. The GST portal rejects anything over 16.',
       null::text, null::bigint
from v_gst_invoice_series i join entities e on e.key = i.entity_key
where e.is_gst_registered and not i.cancelled and length(i.invoice_number) > 16

union all
select i.entity_key, i.period_month, 'invoice_number_bad_chars', 'blocker', 'document_summary',
       'invoice', i.id, i.invoice_number,
       'Invoice number contains characters the GST portal disallows. Only letters, digits, / and - are permitted.',
       null::text, null::bigint
from v_gst_invoice_series i join entities e on e.key = i.entity_key
where e.is_gst_registered and not i.cancelled and i.invoice_number ~ '[^A-Za-z0-9/-]'

union all
select i.entity_key, i.period_month, 'duplicate_invoice_number', 'blocker', 'document_summary',
       'invoice', i.id, i.invoice_number,
       'This invoice number appears more than once for this entity.',
       null::text, null::bigint
from v_gst_invoice_series i join entities e on e.key = i.entity_key
where e.is_gst_registered and not i.cancelled
  and exists (select 1 from v_gst_invoice_series d
               where d.entity_key = i.entity_key and d.invoice_number = i.invoice_number
                 and d.id <> i.id and not d.cancelled)

-- ========================= TRANSACTIONS =========================
union all
select s.entity_key, date_trunc('month', s.effective_sale_date)::date, 'voided_sale_with_live_invoice', 'blocker', 'transactions',
       'sale', s.id, coalesce(s.customer_name, s.id::text),
       'Sale was voided but its invoice is still live, so the return reports a supply that was reversed. Needs a credit note.',
       null::text, null::bigint
from sale_entity s join entities e on e.key = s.entity_key
where e.is_gst_registered and coalesce(s.is_deleted,false) = true and s.invoice_id is not null

union all
select i.entity_key, date_trunc('month', i.invoice_date)::date, 'zero_gst_on_gst_entity', 'blocker', 'transactions',
       'invoice', i.id, i.invoice_number,
       'Taxable value of ' || to_char(coalesce(i.subtotal,0), 'FM999999990.00') ||
       ' carries no GST on a GST-registered entity. Either exempt/nil-rated and needs to be reported as such, or output tax is missing.',
       null::text, null::bigint
from invoices i join entities e on e.key = i.entity_key
where e.is_gst_registered and coalesce(i.is_deleted,false) = false
  and coalesce(i.invoice_type,'sales') = 'sales'
  and coalesce(i.subtotal,0) > 0 and coalesce(i.total_gst,0) = 0

union all
select i.entity_key, date_trunc('month', i.invoice_date)::date, 'tax_computation_mismatch', 'blocker', 'transactions',
       'invoice', i.id, i.invoice_number,
       'Tax of ' || to_char(coalesce(i.total_gst,0), 'FM999999990.00') || ' on ' ||
       to_char(coalesce(i.subtotal,0), 'FM999999990.00') || ' implies ' ||
       to_char(round((coalesce(i.total_gst,0) / nullif(i.subtotal,0)) * 100, 2), 'FM990.00') ||
       '%, which is not a GST slab rate.',
       null::text, null::bigint
from invoices i join entities e on e.key = i.entity_key
where e.is_gst_registered and coalesce(i.is_deleted,false) = false
  and coalesce(i.invoice_type,'sales') = 'sales'
  and coalesce(i.subtotal,0) > 0 and coalesce(i.total_gst,0) > 0
  and round((coalesce(i.total_gst,0) / nullif(i.subtotal,0)) * 100, 2) not in (0,0.25,1.5,3,5,12,18,28,40)

union all
select i.entity_key, date_trunc('month', i.invoice_date)::date, 'value_mismatch', 'blocker', 'transactions',
       'invoice', i.id, i.invoice_number,
       'Grand total does not equal taxable value plus tax (off by ' ||
       to_char(abs(coalesce(i.grand_total,0) - (coalesce(i.subtotal,0) + coalesce(i.total_gst,0))), 'FM999999990.00') || ').',
       null::text, null::bigint
from invoices i join entities e on e.key = i.entity_key
where e.is_gst_registered and coalesce(i.is_deleted,false) = false
  and coalesce(i.invoice_type,'sales') = 'sales'
  and abs(coalesce(i.grand_total,0) - (coalesce(i.subtotal,0) + coalesce(i.total_gst,0))) > 0.05

union all
select i.entity_key, date_trunc('month', i.invoice_date)::date, 'wrong_tax_type', 'blocker', 'transactions',
       'invoice', i.id, i.invoice_number,
       'Place of supply ' || coalesce(i.place_of_supply,'(none)') || ' against entity state ' ||
       coalesce(e.state_code,'?') || ' but the line charges ' ||
       case when coalesce(li.igst_amount,0) > 0 then 'IGST' else 'CGST+SGST' end || '.',
       null::text, null::bigint
from invoices i
  join entities e on e.key = i.entity_key
  join invoice_items li on li.invoice_id = i.id
where e.is_gst_registered and coalesce(i.is_deleted,false) = false
  and coalesce(i.invoice_type,'sales') = 'sales'
  and i.place_of_supply is not null
  and (
    (i.place_of_supply = e.state_code and coalesce(li.igst_amount,0) > 0)
    or (i.place_of_supply <> e.state_code and (coalesce(li.cgst_amount,0) > 0 or coalesce(li.sgst_amount,0) > 0))
  )

union all
select i.entity_key, date_trunc('month', i.invoice_date)::date, 'missing_place_of_supply', 'blocker', 'transactions',
       'invoice', i.id, i.invoice_number,
       'No place of supply recorded, so the CGST/SGST-versus-IGST split cannot be justified.',
       null::text, null::bigint
from invoices i join entities e on e.key = i.entity_key
where e.is_gst_registered and coalesce(i.is_deleted,false) = false
  and coalesce(i.invoice_type,'sales') = 'sales'
  and nullif(trim(coalesce(i.place_of_supply,'')),'') is null

union all
select i.entity_key, date_trunc('month', i.invoice_date)::date, 'eway_bill_missing', 'warning', 'transactions',
       'invoice', i.id, i.invoice_number,
       'Invoice value is ' || to_char(coalesce(i.grand_total,0), 'FM999999990.00') ||
       '. Movement of goods over 50,000 in Uttar Pradesh needs an e-way bill.',
       null::text, null::bigint
from invoices i join entities e on e.key = i.entity_key
where e.is_gst_registered and coalesce(i.is_deleted,false) = false
  and coalesce(i.invoice_type,'sales') = 'sales'
  and coalesce(i.grand_total,0) > 50000
  and nullif(trim(coalesce(i.eway_bill_number,'')),'') is null

-- ========================= PARTY =========================
union all
select i.entity_key, date_trunc('month', i.invoice_date)::date, 'invalid_gstin_format', 'blocker', 'transactions',
       'invoice', i.id, i.invoice_number,
       'Customer GSTIN ' || i.customer_gst || ' fails the check-digit test, so the portal will reject this B2B row.',
       null::text, null::bigint
from invoices i join entities e on e.key = i.entity_key
where e.is_gst_registered and coalesce(i.is_deleted,false) = false
  and coalesce(i.invoice_type,'sales') = 'sales'
  and nullif(trim(coalesce(i.customer_gst,'')),'') is not null
  and not gstin_is_valid(i.customer_gst)

union all
select 'digitalbluez', null::date, 'gstin_state_mismatch', 'warning', 'transactions',
       'customer', c.id, c.customer_name,
       'GSTIN starts with ' || substr(trim(c.gst_number),1,2) || ' but the customer record says state ' ||
       trim(c.state_code) || '. Place of supply resolves from the GSTIN first, so the state field is what is wrong.',
       null::text, null::bigint
from customers c
where coalesce(c.is_deleted,false) = false
  and nullif(trim(coalesce(c.gst_number,'')),'') is not null
  and nullif(trim(coalesce(c.state_code,'')),'') is not null
  and substr(trim(c.gst_number),1,2) <> trim(c.state_code)

union all
select 'digitalbluez', null::date, 'gstin_has_whitespace', 'blocker', 'transactions',
       'customer', c.id, c.customer_name,
       'GSTIN is stored with leading or trailing whitespace. The portal requires exactly 15 characters with none.',
       null::text, null::bigint
from customers c
where coalesce(c.is_deleted,false) = false
  and nullif(trim(coalesce(c.gst_number,'')),'') is not null
  and c.gst_number <> trim(c.gst_number)

union all
select 'digitalbluez', null::date, 'customer_missing_state', 'warning', 'transactions',
       'customer', c.id, c.customer_name,
       'No GSTIN and no state on file, so place of supply silently defaults to the seller''s own state. An out-of-state sale would be taxed as intra-state.',
       null::text, null::bigint
from customers c
where coalesce(c.is_deleted,false) = false
  and nullif(trim(coalesce(c.gst_number,'')),'') is null
  and nullif(trim(coalesce(c.state_code,'')),'') is null
  and exists (select 1 from sales sx where sx.customer_id = c.id and coalesce(sx.is_deleted,false) = false)

union all
select 'digitalbluez', null::date, 'b2b_missing_gstin', 'blocker', 'transactions',
       'customer', c.id, c.customer_name,
       'Marked as a registered business but has no GSTIN, so its supplies cannot be reported under B2B.',
       null::text, null::bigint
from customers c
where coalesce(c.is_deleted,false) = false
  and c.gst_treatment in ('registered_regular','registered_composition')
  and nullif(trim(coalesce(c.gst_number,'')),'') is null

-- ========================= HSN SUMMARY =========================
union all
select 'digitalbluez', null::date, 'missing_hsn', 'blocker', 'hsn_summary',
       'sku', s.id, coalesce(s.full_sku_code, s.sku_description, s.id::text),
       'No HSN code. Table 12 is mandatory and the portal now validates HSN against its own master, so this SKU cannot be reported.',
       null::text, null::bigint
from sku_master s
where s.category <> 'SERVICE'
  and nullif(trim(coalesce(s.hsn_code,'')),'') is null
  and exists (select 1 from invoice_items li where li.sku_id = s.id)

union all
select 'digitalbluez', null::date, 'hsn_too_short', 'blocker', 'hsn_summary',
       'sku', s.id, coalesce(s.full_sku_code, s.sku_description, s.id::text),
       'HSN ' || s.hsn_code || ' is shorter than the 4 digits required at this turnover.',
       null::text, null::bigint
from sku_master s
where s.category <> 'SERVICE'
  and nullif(trim(coalesce(s.hsn_code,'')),'') is not null
  and length(regexp_replace(s.hsn_code, '[^0-9]', '', 'g')) < 4

union all
select 'digitalbluez', null::date, 'hsn_not_numeric', 'blocker', 'hsn_summary',
       'sku', s.id, coalesce(s.full_sku_code, s.sku_description, s.id::text),
       'HSN ' || s.hsn_code || ' contains non-numeric characters.',
       null::text, null::bigint
from sku_master s
where nullif(trim(coalesce(s.hsn_code,'')),'') is not null
  and s.hsn_code ~ '[^0-9]'

union all
select 'digitalbluez', null::date, 'service_without_sac', 'blocker', 'hsn_summary',
       'sku', s.id, coalesce(s.full_sku_code, s.sku_description, s.id::text),
       'Service SKU has no SAC code. A supply of service needs a SAC, not a goods HSN.',
       null::text, null::bigint
from sku_master s
where s.category = 'SERVICE' and s.sac_code_id is null

union all
select o.entity_key, o.period_month, 'invoice_line_hsn_unresolvable', 'blocker', 'hsn_summary',
       'invoice', o.invoice_id, o.invoice_number || ' — ' || left(o.description, 40),
       'No HSN/SAC on the line, its SKU, or any linked SAC, so ' ||
       to_char(o.txval, 'FM999999990.00') || ' of taxable value is missing from Table 12 while still ' ||
       'reported in Tables 4/5/7.' ||
       case when o.item_type = 'repair'
            then ' Computer repair is normally SAC 998713 -- confirm with your CA before applying it.'
            when o.item_type = 'rental' then ' Computer rental is SAC 997315.'
            else ' Set an HSN on the SKU in SKU Master.' end,
       null::text, null::bigint
from v_gst_outward_lines o
where o.hsn_code is null

union all
select 'digitalbluez', null::date, 'hsn_inconsistent_for_sku', 'warning', 'hsn_summary',
       'sku', li.sku_id, coalesce(s.full_sku_code, s.sku_description, li.sku_id::text),
       'Invoiced under more than one HSN: ' || string_agg(distinct li.hsn_code, ', '),
       null::text, null::bigint
from invoice_items li
  join sku_master s on s.id = li.sku_id
where li.sku_id is not null and nullif(trim(coalesce(li.hsn_code,'')),'') is not null
group by li.sku_id, s.full_sku_code, s.sku_description
having count(distinct li.hsn_code) > 1

union all
select
  coalesce(e.entity_key, 'digitalbluez'),
  date_trunc('month', e.expense_date)::date,
  'rcm_credit_unclaimed', 'warning', 'transactions',
  'expense', e.id, left(coalesce(e.description, 'Expense'), 60),
  'Reverse charge of ' || to_char(coalesce(e.gst_amount, 0), 'FM999999990.00') ||
  ' is recorded as owed but not claimed back. The liability lands in 3B 3.1(d) either way; the matching credit only reaches 4A once it is marked claimed.',
  null::text, null::bigint
from expenses e
where coalesce(e.is_deleted, false) = false
  and e.supply_type in ('rcm_domestic', 'rcm_import_services')
  and coalesce(e.gst_amount, 0) > 0
  and coalesce(e.itc_status, 'pending') = 'pending'

union all
select p.entity_key, p.period_month, 'zoho_register_not_uploaded', 'blocker', 'document_summary',
       'series', null::uuid, to_char(p.period_month, 'Mon YYYY'),
       (p.status->>'reason'),
       null::text, null::bigint
from (
  select a.entity_key, a.period_month,
         gst_zoho_register_status(a.entity_key, a.period_month,
           (a.period_month + interval '1 month - 1 day')::date) as status
  from (
    select i.entity_key, date_trunc('month', i.invoice_date)::date as period_month
    from invoices i join business_profiles b on b.key = i.entity_key
    where b.is_gst_registered and coalesce(i.is_deleted,false) = false
      and coalesce(i.invoice_type,'sales') in ('sales','credit_note')
    union
    select se.entity_key, date_trunc('month', se.effective_sale_date)::date
    from sale_entity se join business_profiles b2 on b2.key = se.entity_key
    where b2.is_gst_registered and coalesce(se.is_deleted,false) = false
      and coalesce(se.sale_type,'') = 'GST'
  ) a
) p
where (p.status->>'uploaded')::boolean = false

union all
select p.entity_key, p.period_month, 'zoho_register_unreconciled', 'blocker', 'document_summary',
       'series', null::uuid, to_char(p.period_month, 'Mon YYYY'),
       (p.status->>'reason'),
       null::text, null::bigint
from (
  select a.entity_key, a.period_month,
         gst_zoho_register_status(a.entity_key, a.period_month,
           (a.period_month + interval '1 month - 1 day')::date) as status
  from (
    select i.entity_key, date_trunc('month', i.invoice_date)::date as period_month
    from invoices i join business_profiles b on b.key = i.entity_key
    where b.is_gst_registered and coalesce(i.is_deleted,false) = false
      and coalesce(i.invoice_type,'sales') in ('sales','credit_note')
  ) a
) p
where (p.status->>'uploaded')::boolean = true
  and (p.status->>'reconciled')::boolean = false

union all
-- A line's gst_rate drives which GSTR-1 / GSTR-3B bucket it lands in (3.1(a) takes
-- rate > 0, 3.1(c) nil/exempt takes rate = 0). If the stored rate disagrees with the
-- tax actually charged, the tax is filed under the wrong rate or silently dropped.
select i.entity_key, date_trunc('month', i.invoice_date)::date, 'line_gst_rate_mismatch', 'blocker', 'transactions',
       'invoice', i.id, i.invoice_number || ' — ' || left(li.description, 40),
       'Line carries tax of ' || to_char(coalesce(li.cgst_amount,0) + coalesce(li.sgst_amount,0) + coalesce(li.igst_amount,0), 'FM999999990.00') ||
       ' on ' || to_char(li.rate * li.quantity, 'FM999999990.00') || ' (' ||
       to_char(round(((coalesce(li.cgst_amount,0) + coalesce(li.sgst_amount,0) + coalesce(li.igst_amount,0)) / (li.rate * li.quantity)) * 100, 2), 'FM990.00') ||
       '%) but its rate field says ' || coalesce(li.gst_rate, 0) ||
       '%. Returns group lines by that rate, so this tax would be filed under the wrong rate or as nil/exempt.',
       null::text, null::bigint
from invoices i
  join entities e on e.key = i.entity_key
  join invoice_items li on li.invoice_id = i.id
where e.is_gst_registered and coalesce(i.is_deleted,false) = false
  and coalesce(i.invoice_type,'sales') in ('sales','credit_note')
  and li.rate * li.quantity > 0
  -- Rupee tolerance per line (same as the Zoho matcher), not a percentage: on a Rs 0.85 line one
  -- paisa of rounding is a 1% swing, which is noise, not a wrong rate.
  and abs((coalesce(li.cgst_amount,0) + coalesce(li.sgst_amount,0) + coalesce(li.igst_amount,0))
          - (li.rate * li.quantity * coalesce(li.gst_rate, 0) / 100)) > 1.0;


comment on view public.v_gst_exceptions is
  'Live GST pre-flight validation, one row per problem. Blockers must be cleared before a return is generated; warnings are advisory. Never stored -- a fixed record simply stops appearing.';

create or replace function public.gst_period_steps(p_entity_key text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_reg boolean;
  v_month date := date_trunc('month', p_from)::date;
  v_b int[] := array_fill(0, array[10]);
  v_w int[] := array_fill(0, array[10]);
  v_fp text[] := array_fill(''::text, array[10]);
  v_status text[] := array_fill('yellow'::text, array[10]);
  v_reason text[] := array_fill(null::text, array[10]);
  v_detail jsonb[] := array_fill('{}'::jsonb, array[10]);
  v_so jsonb;
  r record;
  -- step 1
  v_unin int; v_unin_tax numeric; v_unin_fp text; v_unpaid int;
  -- steps 4/5
  v_z record; v_z_found boolean := false;
  v_amt int := 0; v_head int := 0; v_ms int := 0;
  v_zc numeric := 0; v_zs numeric := 0; v_zi numeric := 0; v_zign numeric := 0;
  v_ec numeric := 0; v_es numeric := 0; v_ei numeric := 0;
  -- steps 6/7
  v_fp1 text; v_f1 record; v_f1_found boolean := false; v_f1_approved boolean; v_f1_match boolean;
  v_all15 boolean; v_sales_locked boolean;
  -- step 8
  v_b2 record; v_b2_found boolean := false; v_open8 int := 0; v_red8 int := 0;
  -- steps 9/10
  v_r3b jsonb; v_fp3 text; v_f3 record; v_f3_found boolean := false; v_f3_approved boolean; v_f3_match boolean;
  v_out_tx numeric := 0; v_out_tax numeric := 0; v_3b_tx numeric; v_3b_tax numeric; v_purch_locked boolean;
  v_titles text[] := array['Sales complete','Invoice & customer checks','HSN & numbering','Zoho register match',
    'Zoho tax-head match','Review & approve GSTR-1','File GSTR-1 & lock sales','Purchases & ITC (GSTR-2B)',
    'Review & approve GSTR-3B','File GSTR-3B'];
  v_signoff_steps int[] := array[1,2,3,8];
  n int;
begin
  select is_gst_registered into v_reg from business_profiles where key = p_entity_key;
  if not coalesce(v_reg, false) then return '[]'::jsonb; end if;

  -- Which exception codes belong to which step. zoho_register_* are deliberately
  -- absent: steps 4/5 are computed from the reconciliation lines directly so a
  -- head-only mismatch cannot turn step 4 red.
  for r in
    select m.step,
           count(*) filter (where e.severity = 'blocker') as bl,
           count(*) filter (where e.severity = 'warning') as wr,
           md5(coalesce(string_agg(
             e.check_code || '|' || coalesce(e.record_id::text, e.record_label, '') || '|' || coalesce(e.period_month::text, ''),
             ',' order by e.check_code, coalesce(e.record_id::text, e.record_label, ''), coalesce(e.period_month::text, ''))
             filter (where e.severity = 'warning'), '')) as fp
    from v_gst_exceptions e
    join (values
      ('voided_sale_with_live_invoice',1),
      ('zero_gst_on_gst_entity',2),('tax_computation_mismatch',2),('value_mismatch',2),('wrong_tax_type',2),
      ('missing_place_of_supply',2),('eway_bill_missing',2),('invalid_gstin_format',2),('gstin_state_mismatch',2),
      ('gstin_has_whitespace',2),('customer_missing_state',2),('b2b_missing_gstin',2),
      ('missing_hsn',3),('hsn_too_short',3),('hsn_not_numeric',3),('service_without_sac',3),
      ('invoice_line_hsn_unresolvable',3),('hsn_inconsistent_for_sku',3),('doc_series_gap',3),
      ('invoice_number_too_long',3),('invoice_number_bad_chars',3),('duplicate_invoice_number',3),
      ('line_gst_rate_mismatch',2),
      ('rcm_credit_unclaimed',8)
    ) as m(check_code, step) on m.check_code = e.check_code
    where e.entity_key = p_entity_key
      and (e.period_month is null or e.period_month between v_month and p_to)
    group by m.step
  loop
    v_b[r.step] := r.bl; v_w[r.step] := r.wr; v_fp[r.step] := r.fp;
  end loop;

  select coalesce(jsonb_object_agg(step::text, jsonb_build_object(
           'fingerprint', fingerprint, 'note', note, 'signed_at', signed_at, 'signed_by', signed_by)), '{}'::jsonb)
    into v_so
  from gst_step_signoffs where entity_key = p_entity_key and period_start = p_from;

  -- ---------- Step 1: sales complete ----------
  select count(*), coalesce(sum(coalesce(s.sale_gst, 0)), 0),
         md5(coalesce(string_agg(s.id::text, ',' order by s.id), ''))
    into v_unin, v_unin_tax, v_unin_fp
  from sales s
  where coalesce(s.is_deleted, false) = false and s.invoice_id is null
    and coalesce(s.sale_type, '') = 'GST'
    and (case when lower(trim(coalesce(s.payment_account, ''))) in ('digitalbluez','techtenth','cash')
              then lower(trim(s.payment_account)) else 'digitalbluez' end) = p_entity_key
    and s.effective_sale_date between p_from and p_to;
  select count(*) into v_unpaid
  from sales s
  where coalesce(s.is_deleted, false) = false and coalesce(s.sale_type, '') = 'GST'
    and (case when lower(trim(coalesce(s.payment_account, ''))) in ('digitalbluez','techtenth','cash')
              then lower(trim(s.payment_account)) else 'digitalbluez' end) = p_entity_key
    and s.effective_sale_date between p_from and p_to
    and coalesce(s.payment_status, '') <> 'paid';
  v_fp[1] := v_unin_fp;
  v_detail[1] := jsonb_build_object('uninvoiced_count', v_unin, 'uninvoiced_tax', v_unin_tax, 'unpaid_count', v_unpaid);
  if v_b[1] > 0 then
    v_status[1] := 'red';
    v_reason[1] := v_b[1] || ' voided sale(s) still have a live invoice -- issue a credit note.';
  elsif v_unin > 0 and (v_so->'1'->>'fingerprint') is distinct from v_unin_fp then
    v_status[1] := 'yellow';
    v_reason[1] := v_unin || ' GST sale(s) have no Zoho invoice recorded yet. Record each invoice, or sign off with a reason (e.g. goods not yet delivered).';
  else
    v_status[1] := 'green';
  end if;

  -- ---------- Steps 2 and 3: exception-driven ----------
  foreach n in array array[2,3] loop
    if v_b[n] > 0 then
      v_status[n] := 'red'; v_reason[n] := v_b[n] || ' blocker(s) to fix before filing.';
    elsif v_w[n] > 0 and (v_so->(n::text)->>'fingerprint') is distinct from v_fp[n] then
      v_status[n] := 'yellow'; v_reason[n] := v_w[n] || ' warning(s) to review and sign off.';
    else
      v_status[n] := 'green';
    end if;
    v_detail[n] := jsonb_build_object('blockers', v_b[n], 'warnings', v_w[n]);
  end loop;

  -- ---------- Steps 4 and 5: Zoho register ----------
  select * into v_z from gst_recon_imports i
   where i.entity_key = p_entity_key and i.kind = 'zoho_invoices'
     and i.period_start <= p_from and i.period_end >= p_to
   order by i.created_at desc limit 1;
  v_z_found := found;

  select coalesce(sum(li.cgst_amount), 0), coalesce(sum(li.sgst_amount), 0), coalesce(sum(li.igst_amount), 0)
    into v_ec, v_es, v_ei
  from invoices i join invoice_items li on li.invoice_id = i.id
  where i.entity_key = p_entity_key and coalesce(i.is_deleted, false) = false
    and coalesce(i.invoice_type, 'sales') = 'sales' and i.invoice_date between p_from and p_to;

  if v_z_found then
    select
      count(*) filter (where l.resolution is null and (l.match_status = 'missing_in_erp' or
        (l.match_status = 'value_mismatch' and l.diff ?| array['taxable_value','doc_value','tax','doc_date','erp_voided']))),
      count(*) filter (where l.resolution is null and l.match_status = 'value_mismatch'
        and l.diff ?| array['tax_heads','place_of_supply']),
      count(*) filter (where l.resolution is null and l.match_status = 'missing_in_source'),
      coalesce(sum(l.cgst) filter (where l.match_status <> 'missing_in_source' and not (l.match_status = 'missing_in_erp' and l.resolution = 'ignored')), 0),
      coalesce(sum(l.sgst) filter (where l.match_status <> 'missing_in_source' and not (l.match_status = 'missing_in_erp' and l.resolution = 'ignored')), 0),
      coalesce(sum(l.igst) filter (where l.match_status <> 'missing_in_source' and not (l.match_status = 'missing_in_erp' and l.resolution = 'ignored')), 0),
      coalesce(sum(coalesce(l.cgst,0) + coalesce(l.sgst,0) + coalesce(l.igst,0)) filter (where l.match_status = 'missing_in_erp' and l.resolution = 'ignored'), 0)
    into v_amt, v_head, v_ms, v_zc, v_zs, v_zi, v_zign
    from gst_recon_lines l where l.import_id = v_z.id;
  end if;

  v_detail[4] := jsonb_build_object('uploaded', v_z_found, 'import_id', case when v_z_found then v_z.id end,
    'rows', case when v_z_found then v_z.row_count end, 'matched', case when v_z_found then v_z.matched_count end,
    'amount_unresolved', v_amt, 'not_in_zoho_unresolved', v_ms);
  if not v_z_found then
    v_status[4] := 'yellow'; v_reason[4] := 'Upload the Zoho invoice register (Invoices report, CSV) covering this whole month.';
  elsif v_amt > 0 then
    v_status[4] := 'red'; v_reason[4] := v_amt || ' invoice(s) are missing from the ERP or disagree on value/date. Fix or resolve each.';
  elsif v_ms > 0 then
    v_status[4] := 'yellow'; v_reason[4] := v_ms || ' ERP invoice(s) are not in your Zoho register -- confirm they are real, or resolve.';
  else
    v_status[4] := 'green';
  end if;

  v_detail[5] := jsonb_build_object('head_unresolved', v_head, 'zoho_ignored_tax', v_zign,
    'erp', jsonb_build_object('cgst', v_ec, 'sgst', v_es, 'igst', v_ei),
    'zoho', jsonb_build_object('cgst', v_zc, 'sgst', v_zs, 'igst', v_zi));
  if not v_z_found then
    v_status[5] := 'yellow'; v_reason[5] := 'Upload the Zoho register in step 4 first.';
  elsif v_z.matcher_version < 2 then
    v_status[5] := 'yellow'; v_reason[5] := 'This upload was matched before tax heads were compared. Press Re-check on the upload below to run the CGST/SGST/IGST comparison.';
  elsif v_head > 0 then
    v_status[5] := 'red'; v_reason[5] := v_head || ' invoice(s) have a different CGST/SGST/IGST split or place of supply in Zoho. Tax paid under the wrong head cannot be offset -- fix at source.';
  else
    v_status[5] := 'green';
  end if;

  -- ---------- Steps 6 and 7: GSTR-1 approval and filing ----------
  v_fp1 := gst_gstr1_fingerprint(p_entity_key, p_from, p_to);
  select * into v_f1 from gst_filings
   where entity_key = p_entity_key and return_type = 'gstr1' and period_start = p_from;
  v_f1_found := found;
  v_f1_approved := v_f1_found and v_f1.status in ('exported', 'filed');
  v_f1_match := v_f1_approved and (v_f1.snapshot_hash is null or v_f1.snapshot_hash = v_fp1);
  v_all15 := v_status[1] = 'green' and v_status[2] = 'green' and v_status[3] = 'green'
         and v_status[4] = 'green' and v_status[5] = 'green';
  v_fp[6] := v_fp1;
  v_detail[6] := jsonb_build_object('approved', v_f1_match, 'approved_at', case when v_f1_approved then v_f1.updated_at end,
    'stale', v_f1_approved and not v_f1_match);

  if v_f1_approved and not v_f1_match then
    if v_f1.status = 'filed' then
      v_status[6] := 'red'; v_reason[6] := 'Figures changed AFTER GSTR-1 was filed. An amendment (GSTR-1A / next-month amendment) is needed -- do not edit further without your CA.';
    else
      v_status[6] := 'yellow'; v_reason[6] := 'Data changed since you approved. Review and approve again.';
    end if;
  elsif v_f1_match then
    v_status[6] := 'green';
  elsif not v_all15 then
    v_status[6] := 'yellow'; v_reason[6] := 'Finish steps 1-5 first -- approval is only allowed when they are all green.';
  else
    v_status[6] := 'yellow'; v_reason[6] := 'Ready. Review the working papers and approve GSTR-1.';
  end if;

  select exists (select 1 from period_locks pl where pl.entity_key = p_entity_key and pl.module = 'sales'
                   and pl.locked_through_date >= p_to) into v_sales_locked;
  v_detail[7] := jsonb_build_object('arn', case when v_f1_found then v_f1.arn end,
    'filed_at', case when v_f1_found then v_f1.filed_at end, 'sales_locked', v_sales_locked);
  if v_f1_found and v_f1.status = 'filed' then
    if not v_f1_match then
      v_status[7] := 'red'; v_reason[7] := v_reason[6];
    elsif v_sales_locked then
      v_status[7] := 'green';
    else
      v_status[7] := 'yellow'; v_reason[7] := 'Filed. Now lock Sales through month-end so nothing can change underneath it.';
    end if;
  elsif v_f1_match then
    v_status[7] := 'yellow'; v_reason[7] := 'Approved. File it on the GST portal, then record the ARN here.';
  else
    v_status[7] := 'yellow'; v_reason[7] := 'Approve GSTR-1 first (step 6).';
  end if;

  -- ---------- Step 8: GSTR-2B / ITC ----------
  select * into v_b2 from gst_recon_imports i
   where i.entity_key = p_entity_key and i.kind = 'gstr2b'
     and i.period_start <= p_from and i.period_end >= p_to
   order by i.created_at desc limit 1;
  v_b2_found := found;
  if v_b2_found then
    select
      count(*) filter (where l.resolution is null),
      count(*) filter (where l.resolution is null and l.match_status = 'missing_in_source'
        and l.matched_type = 'purchase_order'
        and exists (select 1 from purchase_order_items poi where poi.po_id = l.matched_id and poi.itc_status = 'claimed'))
    into v_open8, v_red8
    from gst_recon_lines l where l.import_id = v_b2.id and l.match_status <> 'matched';
  end if;
  v_detail[8] := jsonb_build_object('uploaded', v_b2_found, 'import_id', case when v_b2_found then v_b2.id end,
    'open_lines', v_open8, 'claimed_not_in_2b', v_red8, 'warnings', v_w[8]);
  if not v_b2_found then
    v_status[8] := 'yellow'; v_reason[8] := 'Upload the GSTR-2B JSON for this month (portal: Returns > GSTR-2B > Download). ITC may be claimed only for invoices that appear in it.';
  elsif v_red8 > 0 then
    v_status[8] := 'red'; v_reason[8] := v_red8 || ' purchase(s) have ITC marked "claimed" but the supplier has not filed (not in GSTR-2B). Do not claim it, or chase the supplier (Rule 36(4) / 88D).';
  elsif v_open8 > 0 then
    v_status[8] := 'yellow'; v_reason[8] := v_open8 || ' GSTR-2B line(s) still need a decision (claim, ineligible, chase supplier).';
  elsif v_w[8] > 0 and (v_so->'8'->>'fingerprint') is distinct from v_fp[8] then
    v_status[8] := 'yellow'; v_reason[8] := v_w[8] || ' reverse-charge credit(s) not yet claimed -- review and sign off.';
  else
    v_status[8] := 'green';
  end if;

  -- ---------- Steps 9 and 10: GSTR-3B ----------
  v_r3b := gst_r3b_summary(p_entity_key, p_from, p_to);
  v_fp3 := md5(coalesce(v_r3b::text, ''));
  select * into v_f3 from gst_filings
   where entity_key = p_entity_key and return_type = 'gstr3b' and period_start = p_from;
  v_f3_found := found;
  v_f3_approved := v_f3_found and v_f3.status in ('exported', 'filed');
  v_f3_match := v_f3_approved and (v_f3.snapshot_hash is null or v_f3.snapshot_hash = v_fp3);

  select coalesce(sum(li.quantity * li.rate * (case when i.invoice_type = 'credit_note' then -1 else 1 end)), 0),
         coalesce(sum((coalesce(li.cgst_amount,0) + coalesce(li.sgst_amount,0) + coalesce(li.igst_amount,0))
                      * (case when i.invoice_type = 'credit_note' then -1 else 1 end)), 0)
    into v_out_tx, v_out_tax
  from invoices i join invoice_items li on li.invoice_id = i.id
  where i.entity_key = p_entity_key and coalesce(i.is_deleted, false) = false
    and coalesce(i.invoice_type, 'sales') in ('sales', 'credit_note') and i.invoice_date between p_from and p_to;
  v_3b_tx := coalesce((v_r3b->'table_3_1'->'a_outward_taxable'->>'taxable_value')::numeric, 0)
           + coalesce((v_r3b->'table_3_1'->'b_zero_rated'->>'taxable_value')::numeric, 0)
           + coalesce((v_r3b->'table_3_1'->'c_nil_exempt'->>'taxable_value')::numeric, 0)
           + coalesce((v_r3b->'table_3_1'->'e_non_gst_outward'->>'taxable_value')::numeric, 0);
  v_3b_tax := coalesce((v_r3b->'table_3_1'->'a_outward_taxable'->>'cgst')::numeric, 0)
            + coalesce((v_r3b->'table_3_1'->'a_outward_taxable'->>'sgst')::numeric, 0)
            + coalesce((v_r3b->'table_3_1'->'a_outward_taxable'->>'igst')::numeric, 0);
  v_fp[9] := v_fp3;
  v_detail[9] := jsonb_build_object('approved', v_f3_match, 'approved_at', case when v_f3_approved then v_f3.updated_at end,
    'gstr1_taxable', v_out_tx, 'gstr1_tax', v_out_tax, 'r3b_taxable', v_3b_tx, 'r3b_tax', v_3b_tax);

  if v_f1_found and v_f1.status = 'filed' and not v_f1_match then
    v_status[9] := 'red'; v_reason[9] := 'GSTR-1 data changed after it was filed, so 3B would not match what the portal holds. Resolve with your CA first.';
  elsif abs(v_3b_tx - v_out_tx) > 1 or abs(v_3b_tax - v_out_tax) > 1 then
    v_status[9] := 'red'; v_reason[9] := 'GSTR-3B Table 3.1 does not tie to GSTR-1: taxable ' || to_char(v_3b_tx, 'FM999999990.00') ||
      ' vs ' || to_char(v_out_tx, 'FM999999990.00') || ', tax ' || to_char(v_3b_tax, 'FM999999990.00') ||
      ' vs ' || to_char(v_out_tax, 'FM999999990.00') || '. The portal fills 3.1 from GSTR-1, so these must agree -- usually a line whose rate field disagrees with its tax.';
  elsif v_status[8] = 'red' then
    v_status[9] := 'red'; v_reason[9] := 'Fix step 8 (ITC claimed without GSTR-2B support) before approving 3B.';
  elsif v_f3_approved and not v_f3_match then
    if v_f3.status = 'filed' then
      v_status[9] := 'red'; v_reason[9] := 'Figures changed AFTER GSTR-3B was filed.';
    else
      v_status[9] := 'yellow'; v_reason[9] := 'Data changed since you approved. Review and approve again.';
    end if;
  elsif v_f3_match then
    v_status[9] := 'green';
  elsif not (v_f1_found and v_f1.status = 'filed') then
    v_status[9] := 'yellow'; v_reason[9] := 'File GSTR-1 first (step 7) -- the portal builds 3B liability from the filed GSTR-1.';
  elsif v_status[8] <> 'green' then
    v_status[9] := 'yellow'; v_reason[9] := 'Finish step 8 (GSTR-2B / ITC) first.';
  else
    v_status[9] := 'yellow'; v_reason[9] := 'Ready. Review Tables 3.1, 3.2, 4 and approve GSTR-3B.';
  end if;

  select exists (select 1 from period_locks pl where pl.entity_key = p_entity_key and pl.module = 'purchases'
                   and pl.locked_through_date >= p_to) into v_purch_locked;
  v_detail[10] := jsonb_build_object('arn', case when v_f3_found then v_f3.arn end,
    'filed_at', case when v_f3_found then v_f3.filed_at end, 'purchases_locked', v_purch_locked);
  if v_f3_found and v_f3.status = 'filed' then
    if not v_f3_match then
      v_status[10] := 'red'; v_reason[10] := v_reason[9];
    elsif v_purch_locked then
      v_status[10] := 'green';
    else
      v_status[10] := 'yellow'; v_reason[10] := 'Filed. Now lock Purchases through month-end.';
    end if;
  elsif v_f3_match then
    v_status[10] := 'yellow'; v_reason[10] := 'Approved. Pay the liability and file on the GST portal, then record the ARN here.';
  else
    v_status[10] := 'yellow'; v_reason[10] := 'Approve GSTR-3B first (step 9).';
  end if;

  return (
    select jsonb_agg(jsonb_build_object(
      'step', s,
      'group', case when s <= 7 then 'gstr1' else 'gstr3b' end,
      'title', v_titles[s],
      'status', v_status[s],
      'reason', v_reason[s],
      'blockers', v_b[s], 'warnings', v_w[s],
      'fingerprint', v_fp[s],
      'signoff_applicable', s = any(v_signoff_steps),
      'signed_off', (v_so->(s::text)->>'fingerprint') is not distinct from v_fp[s] and v_so ? (s::text),
      'signed_off_at', v_so->(s::text)->>'signed_at',
      'signed_off_note', v_so->(s::text)->>'note',
      'detail', v_detail[s]
    ) order by s)
    from generate_series(1, 10) s
  );
end;
$function$;


commit;
