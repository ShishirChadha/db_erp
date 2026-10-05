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
-- Gaps are found WITHIN each series, not across all invoices. Once the ERP
-- starts issuing its own series alongside Zoho's, treating every suffix as one
-- sequence would invent a gap of seventy numbers plus a duplicate.
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
       'Invoice number ' || g.series_key || g.missing_seq || ' is missing from the series. Table 13 needs every number accounted for as either issued or cancelled -- this is either a cancelled invoice or one never recorded in the ERP.' as detail
from series_gaps g join entities e on e.key = g.entity_key
where e.is_gst_registered

union all
select i.entity_key, i.period_month, 'invoice_number_too_long', 'blocker', 'document_summary',
       'invoice', i.id, i.invoice_number,
       'Invoice number is ' || length(i.invoice_number) || ' characters. The GST portal rejects anything over 16.'
from v_gst_invoice_series i join entities e on e.key = i.entity_key
where e.is_gst_registered and not i.cancelled and length(i.invoice_number) > 16

union all
select i.entity_key, i.period_month, 'invoice_number_bad_chars', 'blocker', 'document_summary',
       'invoice', i.id, i.invoice_number,
       'Invoice number contains characters the GST portal disallows. Only letters, digits, / and - are permitted.'
from v_gst_invoice_series i join entities e on e.key = i.entity_key
where e.is_gst_registered and not i.cancelled and i.invoice_number ~ '[^A-Za-z0-9/-]'

union all
select i.entity_key, i.period_month, 'duplicate_invoice_number', 'blocker', 'document_summary',
       'invoice', i.id, i.invoice_number,
       'This invoice number appears more than once for this entity.'
from v_gst_invoice_series i join entities e on e.key = i.entity_key
where e.is_gst_registered and not i.cancelled
  and exists (select 1 from v_gst_invoice_series d
               where d.entity_key = i.entity_key and d.invoice_number = i.invoice_number
                 and d.id <> i.id and not d.cancelled)

-- ========================= TRANSACTIONS =========================
-- Completeness: a taxed sale with no invoice cannot appear in GSTR-1 at all.
union all
-- A WARNING, not a blocker. Invoices are issued in Zoho, not here, so a sale
-- with no invoice_id measures this system's recording backlog rather than a tax
-- gap -- and under the business's process a sale is deliberately left
-- uninvoiced until payment is secured. What actually gates filing is whether
-- the period's Zoho register reconciles (checked below).
select s.entity_key, date_trunc('month', s.effective_sale_date)::date, 'gst_sale_not_invoiced', 'warning', 'transactions',
       'sale', s.id, coalesce(s.customer_name, s.asset_number, s.id::text),
       'Sale of ' || to_char(coalesce(s.sale_total,0), 'FM999999990.00') ||
       ' (tax ' || to_char(coalesce(s.sale_gst,0), 'FM999999990.00') ||
       ') has no invoice recorded here' ||
       case when coalesce(s.payment_status,'') = 'paid'
            then '. It is fully paid, so the tax point has already passed -- check a Zoho invoice exists and record it.'
            else ' and is not yet paid, which is expected until payment is secured.' end
from sale_entity s join entities e on e.key = s.entity_key
where e.is_gst_registered and coalesce(s.is_deleted,false) = false
  and s.invoice_id is null and coalesce(s.sale_type,'') = 'GST'
  -- A sample, gift or warranty replacement will never be invoiced.
  and s.gst_exclusion_reason is null

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
having count(distinct li.hsn_code) > 1

union all
-- Reverse-charge credit recorded but never claimed. A reverse-charge expense
-- creates a liability AND an entitlement; paying the one without taking the
-- other is a pure loss, and nothing else would point at it -- the liability
-- reaches 3B 3.1(d) automatically, while the credit only reaches 4A once it is
-- marked claimed.
select
  coalesce(e.entity_key, 'digitalbluez'),
  date_trunc('month', e.expense_date)::date,
  'rcm_credit_unclaimed', 'warning', 'transactions',
  'expense', e.id, left(coalesce(e.description, 'Expense'), 60),
  'Reverse charge of ' || to_char(coalesce(e.gst_amount, 0), 'FM999999990.00') ||
  ' is recorded as owed but not claimed back. The liability lands in 3B 3.1(d) either way; the matching credit only reaches 4A once it is marked claimed.'
from expenses e
where coalesce(e.is_deleted, false) = false
  and e.supply_type in ('rcm_domestic', 'rcm_import_services')
  and coalesce(e.gst_amount, 0) > 0
  and coalesce(e.itc_status, 'pending') = 'pending'

union all
-- Filing gate. Invoices are issued in Zoho, so a period cannot be considered
-- checked until its register has been uploaded here and every row matched or
-- explicitly resolved.
select p.entity_key, p.period_month, 'zoho_register_not_uploaded', 'blocker', 'document_summary',
       'series', null::uuid, to_char(p.period_month, 'Mon YYYY'),
       (p.status->>'reason')
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
       (p.status->>'reason')
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
-- An exclusion removes value from the tax base, so it gets owner sign-off
-- before the period is filed.
select s.entity_key, date_trunc('month', s.effective_sale_date)::date,
       'gst_exclusion_needs_review', 'warning', 'transactions',
       'sale', s.id, coalesce(s.customer_name, s.asset_number, s.id::text),
       'Excluded from GST as ' || s.gst_exclusion_reason ||
       coalesce(' (' || nullif(trim(s.gst_exclusion_note), '') || ')', '') ||
       ', worth ' || to_char(coalesce(s.sale_total,0), 'FM999999990.00') ||
       '. Confirm before filing -- an exclusion takes value out of the return.'
from sale_entity s join entities e on e.key = s.entity_key
where e.is_gst_registered and coalesce(s.is_deleted,false) = false
  and s.gst_exclusion_reason is not null
  and s.gst_exclusion_reviewed_at is null

union all
-- s.17(5)(h): input credit is BLOCKED on goods disposed of by way of gift or
-- free samples. So a sample costs the credit claimed when the unit was bought;
-- it is not a free way to move stock. Raised as a warning because the reversal
-- is a judgement on the original purchase, not something this can compute.
select s.entity_key, date_trunc('month', s.effective_sale_date)::date,
       'gift_itc_reversal_due', 'warning', 'transactions',
       'sale', s.id, coalesce(s.customer_name, s.asset_number, s.id::text),
       'Given as a ' || s.gst_exclusion_reason ||
       ', so no output tax arises -- but s.17(5)(h) blocks the input credit on goods disposed of as gifts or free samples. The credit claimed when this unit was purchased needs reversing in 3B Table 4(B).'
from sale_entity s join entities e on e.key = s.entity_key
where e.is_gst_registered and coalesce(s.is_deleted,false) = false
  and s.gst_exclusion_reason in ('sample', 'gift');

comment on view public.v_gst_exceptions is
  'Live GST pre-flight validation, one row per problem. Blockers must be cleared before a return is generated; warnings are advisory. Never stored -- a fixed record simply stops appearing.';

commit;
