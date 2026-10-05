begin;

-- This migration is applied AFTER v_gst_exceptions has been dropped
-- (20261005_gst_drop_view_before_column_drop.sql) and the exclusion columns
-- dropped from `sales` (20261005_gst_drop_exclusion_columns.sql) -- see those
-- files for why the ordering matters (the sale_entity CTE's `s.*` would
-- otherwise re-establish a dependency on columns this revision no longer
-- reads, blocking the drop). Recreating fresh here means `s.*` naturally
-- expands against the now-narrower table.
create view public.v_gst_exceptions as
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
-- gst_sale_not_invoiced was removed here (2026-10-05): invoices are issued in
-- Zoho, not in the ERP, and a sale is deliberately left uninvoiced until
-- payment is secured -- so "no invoice_id" was never a per-row compliance
-- question, only this system's own recording backlog. Completeness is now a
-- neutral count in gst_return_readiness() (not a check row here, and not part
-- of blockers/warnings), backed by two independent reconciliations instead of
-- per-sale chasing: the Zoho register (zoho_register_not_uploaded/
-- unreconciled, below) and bank-credit reconciliation (bank_statement_not_
-- uploaded/unexplained_bank_credit, below) -- see docs/decisions.md.
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
-- Bank-credit safety net (2026-10-05). Owner's "dead sure" check: money that
-- arrived with no paper trail anywhere, neither an ERP sale nor a Zoho
-- invoice. Reuses the EXISTING Bank Reconciliation module's recon_status
-- (bank_transactions/bank_transaction_matches, already built) rather than a
-- second upload flow -- see gst_bank_credit_status(). Warning, not a blocker,
-- per the owner's decision: surfaced clearly but does not stop filing.
select p.entity_key, p.period_month, 'bank_statement_not_uploaded', 'warning', 'document_summary',
       'series', null::uuid, to_char(p.period_month, 'Mon YYYY'),
       (p.status->>'reason')
from (
  select b.key as entity_key, pm.period_month,
         gst_bank_credit_status(b.key, pm.period_month,
           (pm.period_month + interval '1 month - 1 day')::date) as status
  from business_profiles b
  cross join (
    select distinct date_trunc('month', i.invoice_date)::date as period_month
    from invoices i
    where coalesce(i.is_deleted,false) = false
      and coalesce(i.invoice_type,'sales') in ('sales','credit_note')
  ) pm
  where b.is_gst_registered
) p
where (p.status->>'uploaded')::boolean = false

union all
select p.entity_key, p.period_month, 'unexplained_bank_credit', 'warning', 'transactions',
       'bank_transaction', (p.txn->>'id')::uuid,
       to_char((p.txn->>'txn_date')::date, 'DD Mon') || ' — ' || to_char(((p.txn->>'credit')::numeric), 'FM999999990.00'),
       'Credit of ' || to_char(((p.txn->>'credit')::numeric), 'FM999999990.00') || ' on ' ||
       (p.txn->>'txn_date') || ' has no (or only partial) matching sale/vendor/expense entry in Bank Reconciliation. ' ||
       'Narration: ' || coalesce(p.txn->>'narration', '(none)') ||
       case when nullif(trim(coalesce(p.txn->>'reference','')),'') is not null
            then ' · Ref: ' || (p.txn->>'reference') else '' end ||
       '. If this is one payment covering more than one invoice, match each portion separately from Recon Sessions.'
from (
  select b.key as entity_key, date_trunc('month', bt.txn_date)::date as period_month, to_jsonb(bt.*) as txn
  from business_profiles b
  join bank_accounts ba on ba.entity_key = b.key
  join bank_transactions bt on bt.bank_account_id = ba.id
  where b.is_gst_registered
    and coalesce(bt.credit,0) > 0
    and bt.recon_status in ('open','split')
) p;

comment on view public.v_gst_exceptions is
  'Live GST pre-flight validation, one row per problem. Blockers must be cleared before a return is generated; warnings are advisory. Never stored -- a fixed record simply stops appearing.';

commit;
