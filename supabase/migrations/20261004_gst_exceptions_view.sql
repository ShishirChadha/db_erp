begin;

create or replace view public.v_gst_exceptions as
with entities as (
  select key, state_code, is_gst_registered from business_profiles
),
-- sales.payment_account is the entity signal; mirrors resolveEntityKey() in
-- lib/invoice-finalize.ts, including its default-to-digitalbluez fallback.
-- Deliberately unfiltered on is_deleted: one check below is specifically about
-- voided sales, so each branch states which it wants.
sale_entity as (
  select s.*,
         case when lower(trim(coalesce(s.payment_account,''))) in ('digitalbluez','techtenth','cash')
              then lower(trim(s.payment_account)) else 'digitalbluez' end as entity_key
  from sales s
),
series as (select * from v_gst_invoice_series),
-- Gaps are attributed to the month of the preceding invoice: the number was
-- consumed during that billing period, whether it was cancelled or never
-- mirrored in from Zoho.
series_gaps as (
  select g.entity_key, g.missing_seq,
         (select max(s2.period_month) from series s2
           where s2.entity_key = g.entity_key and s2.seq < g.missing_seq) as period_month
  from (
    select s.entity_key,
           generate_series(min(s.seq), max(s.seq)) as missing_seq
    from series s where s.seq is not null
    group by s.entity_key
  ) g
  where not exists (
    select 1 from series s3 where s3.entity_key = g.entity_key and s3.seq = g.missing_seq
  )
)

-- ========================= DOCUMENT SUMMARY =========================
select e.key as entity_key, g.period_month, 'doc_series_gap' as check_code,
       'blocker' as severity, 'document_summary' as check_group,
       'series' as record_type, null::uuid as record_id,
       g.missing_seq::text as record_label,
       'Invoice number ' || g.missing_seq || ' is missing from the series. Table 13 needs every number accounted for as either issued or cancelled -- this is either a cancelled invoice or one never recorded in the ERP.' as detail
from series_gaps g join entities e on e.key = g.entity_key
where e.is_gst_registered

union all
select i.entity_key, i.period_month, 'invoice_number_too_long', 'blocker', 'document_summary',
       'invoice', i.id, i.invoice_number,
       'Invoice number is ' || length(i.invoice_number) || ' characters. The GST portal rejects anything over 16.'
from v_gst_invoice_series i join entities e on e.key = i.entity_key
where e.is_gst_registered and length(i.invoice_number) > 16

union all
select i.entity_key, i.period_month, 'invoice_number_bad_chars', 'blocker', 'document_summary',
       'invoice', i.id, i.invoice_number,
       'Invoice number contains characters the GST portal disallows. Only letters, digits, / and - are permitted.'
from v_gst_invoice_series i join entities e on e.key = i.entity_key
where e.is_gst_registered and i.invoice_number ~ '[^A-Za-z0-9/-]'

union all
select i.entity_key, i.period_month, 'duplicate_invoice_number', 'blocker', 'document_summary',
       'invoice', i.id, i.invoice_number,
       'This invoice number appears more than once for this entity.'
from v_gst_invoice_series i join entities e on e.key = i.entity_key
where e.is_gst_registered
  and exists (select 1 from v_gst_invoice_series d
               where d.entity_key = i.entity_key and d.invoice_number = i.invoice_number and d.id <> i.id)

-- ========================= TRANSACTIONS =========================
-- Completeness: a taxed sale with no invoice cannot appear in GSTR-1 at all.
union all
select s.entity_key, date_trunc('month', s.effective_sale_date)::date, 'gst_sale_not_invoiced', 'blocker', 'transactions',
       'sale', s.id, coalesce(s.customer_name, s.asset_number, s.id::text),
       'Sale of ' || to_char(coalesce(s.sale_total,0), 'FM999999990.00') ||
       ' (tax ' || to_char(coalesce(s.sale_gst,0), 'FM999999990.00') ||
       ') has no invoice, so it is absent from the return.'
from sale_entity s join entities e on e.key = s.entity_key
where e.is_gst_registered and coalesce(s.is_deleted,false) = false
  and s.invoice_id is null and coalesce(s.sale_type,'') = 'GST'

union all
select s.entity_key, date_trunc('month', s.effective_sale_date)::date, 'voided_sale_with_live_invoice', 'blocker', 'transactions',
       'sale', s.id, coalesce(s.customer_name, s.id::text),
       'Sale was voided but its invoice is still live, so the return reports a supply that was reversed. Needs a credit note.'
from sale_entity s join entities e on e.key = s.entity_key
where e.is_gst_registered and coalesce(s.is_deleted,false) = true and s.invoice_id is not null

-- Tax correctness, at the invoice level.
union all
select i.entity_key, date_trunc('month', i.invoice_date)::date, 'zero_gst_on_gst_entity', 'blocker', 'transactions',
       'invoice', i.id, i.invoice_number,
       'Taxable value of ' || to_char(coalesce(i.subtotal,0), 'FM999999990.00') ||
       ' carries no GST on a GST-registered entity. Either exempt/nil-rated and needs to be reported as such, or output tax is missing.'
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
       '%, which is not a GST slab rate.'
from invoices i join entities e on e.key = i.entity_key
where e.is_gst_registered and coalesce(i.is_deleted,false) = false
  and coalesce(i.invoice_type,'sales') = 'sales'
  and coalesce(i.subtotal,0) > 0 and coalesce(i.total_gst,0) > 0
  and round((coalesce(i.total_gst,0) / nullif(i.subtotal,0)) * 100, 2) not in (0,0.25,1.5,3,5,12,18,28,40)

union all
select i.entity_key, date_trunc('month', i.invoice_date)::date, 'value_mismatch', 'blocker', 'transactions',
       'invoice', i.id, i.invoice_number,
       'Grand total does not equal taxable value plus tax (off by ' ||
       to_char(abs(coalesce(i.grand_total,0) - (coalesce(i.subtotal,0) + coalesce(i.total_gst,0))), 'FM999999990.00') || ').'
from invoices i join entities e on e.key = i.entity_key
where e.is_gst_registered and coalesce(i.is_deleted,false) = false
  and coalesce(i.invoice_type,'sales') = 'sales'
  and abs(coalesce(i.grand_total,0) - (coalesce(i.subtotal,0) + coalesce(i.total_gst,0))) > 0.05

-- Wrong tax head for the place of supply.
union all
select i.entity_key, date_trunc('month', i.invoice_date)::date, 'wrong_tax_type', 'blocker', 'transactions',
       'invoice', i.id, i.invoice_number,
       'Place of supply ' || coalesce(i.place_of_supply,'(none)') || ' against entity state ' ||
       coalesce(e.state_code,'?') || ' but the line charges ' ||
       case when coalesce(li.igst_amount,0) > 0 then 'IGST' else 'CGST+SGST' end || '.'
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
       'No place of supply recorded, so the CGST/SGST-versus-IGST split cannot be justified.'
from invoices i join entities e on e.key = i.entity_key
where e.is_gst_registered and coalesce(i.is_deleted,false) = false
  and coalesce(i.invoice_type,'sales') = 'sales'
  and nullif(trim(coalesce(i.place_of_supply,'')),'') is null

union all
select i.entity_key, date_trunc('month', i.invoice_date)::date, 'eway_bill_missing', 'warning', 'transactions',
       'invoice', i.id, i.invoice_number,
       'Invoice value is ' || to_char(coalesce(i.grand_total,0), 'FM999999990.00') ||
       '. Movement of goods over 50,000 in Uttar Pradesh needs an e-way bill.'
from invoices i join entities e on e.key = i.entity_key
where e.is_gst_registered and coalesce(i.is_deleted,false) = false
  and coalesce(i.invoice_type,'sales') = 'sales'
  and coalesce(i.grand_total,0) > 50000
  and nullif(trim(coalesce(i.eway_bill_number,'')),'') is null

-- ========================= PARTY =========================
union all
select i.entity_key, date_trunc('month', i.invoice_date)::date, 'invalid_gstin_format', 'blocker', 'transactions',
       'invoice', i.id, i.invoice_number,
       'Customer GSTIN ' || i.customer_gst || ' fails the check-digit test, so the portal will reject this B2B row.'
from invoices i join entities e on e.key = i.entity_key
where e.is_gst_registered and coalesce(i.is_deleted,false) = false
  and coalesce(i.invoice_type,'sales') = 'sales'
  and nullif(trim(coalesce(i.customer_gst,'')),'') is not null
  and not gstin_is_valid(i.customer_gst)

union all
select 'digitalbluez', null::date, 'gstin_state_mismatch', 'warning', 'transactions',
       'customer', c.id, c.customer_name,
       'GSTIN starts with ' || substr(trim(c.gst_number),1,2) || ' but the customer record says state ' ||
       trim(c.state_code) || '. Place of supply resolves from the GSTIN first, so the state field is what is wrong.'
from customers c
where coalesce(c.is_deleted,false) = false
  and nullif(trim(coalesce(c.gst_number,'')),'') is not null
  and nullif(trim(coalesce(c.state_code,'')),'') is not null
  and substr(trim(c.gst_number),1,2) <> trim(c.state_code)

union all
-- A GSTIN stored with surrounding whitespace is written into the return
-- verbatim, where the portal's strict 15-character check rejects it.
select 'digitalbluez', null::date, 'gstin_has_whitespace', 'blocker', 'transactions',
       'customer', c.id, c.customer_name,
       'GSTIN is stored with leading or trailing whitespace. The portal requires exactly 15 characters with none.'
from customers c
where coalesce(c.is_deleted,false) = false
  and nullif(trim(coalesce(c.gst_number,'')),'') is not null
  and c.gst_number <> trim(c.gst_number)

union all
-- No GSTIN and no state: classifyGst() falls back to the entity's own state,
-- so an out-of-state B2C sale is silently taxed as intra-state CGST+SGST when
-- it should be IGST. Only raised for customers that actually have sales.
select 'digitalbluez', null::date, 'customer_missing_state', 'warning', 'transactions',
       'customer', c.id, c.customer_name,
       'No GSTIN and no state on file, so place of supply silently defaults to the seller''s own state. An out-of-state sale would be taxed as intra-state.'
from customers c
where coalesce(c.is_deleted,false) = false
  and nullif(trim(coalesce(c.gst_number,'')),'') is null
  and nullif(trim(coalesce(c.state_code,'')),'') is null
  and exists (select 1 from sales sx where sx.customer_id = c.id and coalesce(sx.is_deleted,false) = false)

union all
select 'digitalbluez', null::date, 'b2b_missing_gstin', 'blocker', 'transactions',
       'customer', c.id, c.customer_name,
       'Marked as a registered business but has no GSTIN, so its supplies cannot be reported under B2B.'
from customers c
where coalesce(c.is_deleted,false) = false
  and c.gst_treatment in ('registered_regular','registered_composition')
  and nullif(trim(coalesce(c.gst_number,'')),'') is null

-- ========================= HSN SUMMARY =========================
union all
select 'digitalbluez', null::date, 'missing_hsn', 'blocker', 'hsn_summary',
       'sku', s.id, coalesce(s.full_sku_code, s.sku_description, s.id::text),
       'No HSN code. Table 12 is mandatory and the portal now validates HSN against its own master, so this SKU cannot be reported.'
from sku_master s
where s.category <> 'SERVICE'
  and nullif(trim(coalesce(s.hsn_code,'')),'') is null
  and exists (select 1 from invoice_items li where li.sku_id = s.id)

union all
select 'digitalbluez', null::date, 'hsn_too_short', 'blocker', 'hsn_summary',
       'sku', s.id, coalesce(s.full_sku_code, s.sku_description, s.id::text),
       'HSN ' || s.hsn_code || ' is shorter than the 4 digits required at this turnover.'
from sku_master s
where s.category <> 'SERVICE'
  and nullif(trim(coalesce(s.hsn_code,'')),'') is not null
  and length(regexp_replace(s.hsn_code, '[^0-9]', '', 'g')) < 4

union all
select 'digitalbluez', null::date, 'hsn_not_numeric', 'blocker', 'hsn_summary',
       'sku', s.id, coalesce(s.full_sku_code, s.sku_description, s.id::text),
       'HSN ' || s.hsn_code || ' contains non-numeric characters.'
from sku_master s
where nullif(trim(coalesce(s.hsn_code,'')),'') is not null
  and s.hsn_code ~ '[^0-9]'

union all
select 'digitalbluez', null::date, 'service_without_sac', 'blocker', 'hsn_summary',
       'sku', s.id, coalesce(s.full_sku_code, s.sku_description, s.id::text),
       'Service SKU has no SAC code. A supply of service needs a SAC, not a goods HSN.'
from sku_master s
where s.category = 'SERVICE' and s.sac_code_id is null

union all
-- An invoice line whose HSN cannot be resolved from the line, its SKU, or a
-- SAC. These drop out of Table 12 while still counting in Tables 4/5/7, which
-- is precisely the mismatch the portal cross-validates. The historical repair
-- lines here carry neither sku_id nor accessory_id (they predate repair
-- charges being SKU-backed), so there is no record to correct -- the code has
-- to be decided and applied deliberately.
select o.entity_key, o.period_month, 'invoice_line_hsn_unresolvable', 'blocker', 'hsn_summary',
       'invoice', o.invoice_id, o.invoice_number || ' — ' || left(o.description, 40),
       'No HSN/SAC on the line, its SKU, or any linked SAC, so ' ||
       to_char(o.txval, 'FM999999990.00') || ' of taxable value is missing from Table 12 while still ' ||
       'reported in Tables 4/5/7.' ||
       case when o.item_type = 'repair'
            then ' Computer repair is normally SAC 998713 -- confirm with your CA before applying it.'
            when o.item_type = 'rental' then ' Computer rental is SAC 997315.'
            else ' Set an HSN on the SKU in SKU Master.' end
from v_gst_outward_lines o
where o.hsn_code is null

union all
-- The same SKU reported under two different HSNs splits its Table 12 rows and
-- breaks the portal's cross-check of Table 12 against Tables 4/5/7.
select 'digitalbluez', null::date, 'hsn_inconsistent_for_sku', 'warning', 'hsn_summary',
       'sku', li.sku_id, coalesce(s.full_sku_code, s.sku_description, li.sku_id::text),
       'Invoiced under more than one HSN: ' || string_agg(distinct li.hsn_code, ', ')
from invoice_items li
  join sku_master s on s.id = li.sku_id
where li.sku_id is not null and nullif(trim(coalesce(li.hsn_code,'')),'') is not null
group by li.sku_id, s.full_sku_code, s.sku_description
having count(distinct li.hsn_code) > 1;

comment on view public.v_gst_exceptions is
  'Live GST pre-flight validation, one row per problem. Blockers must be cleared before a return is generated; warnings are advisory. Never stored -- a fixed record simply stops appearing.';

commit;
