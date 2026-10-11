-- A doc_series_gap today has no resolution path -- a number raised and
-- cancelled entirely in Zoho (never given an ERP row, not even a
-- soft-deleted one) is stuck as a permanent blocker, with no way to tell the
-- system "I checked, this one was cancelled" the way a gst_recon_lines row
-- can be resolved/ignored. Table 13 also silently under-counts that number
-- (gst_r1_docs_issued only ever sees rows that exist in v_gst_invoice_series)
-- even though a real document nature code was consumed and needs reporting
-- as cancelled, not omitted.
--
-- gst_void_invoice_numbers is the acknowledgment: who decided it, why, and
-- which exact (series, sequence) it covers. period_month is computed once at
-- insert time (same "attributed to the month of the preceding invoice" rule
-- series_gaps already uses) rather than recomputed per read.
begin;

create table public.gst_void_invoice_numbers (
  id uuid primary key default gen_random_uuid(),
  entity_key text not null references business_profiles(key),
  series_key text not null,
  seq bigint not null,
  doc_type text not null default 'sales' check (doc_type in ('sales','credit_note')),
  period_month date not null,
  reason text not null,
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now(),
  unique (entity_key, series_key, seq, doc_type)
);

comment on table public.gst_void_invoice_numbers is
  'Acknowledges a doc_series_gap number as one that was genuinely raised and cancelled outside the ERP (typically Zoho) before ever getting a row here -- as opposed to a number simply missing data. Clears the matching blocker in v_gst_exceptions and is folded into gst_r1_docs_issued()''s cancel/totnum counts so Table 13 still reports the number as cancelled rather than omitting it.';

-- Computes period_month the same way series_gaps does, inserts, and returns
-- the created row. Owner-only enforcement happens in the API route, same as
-- every other GST write in this module.
create or replace function public.gst_acknowledge_series_gap(
  p_entity_key text, p_series_key text, p_seq bigint, p_doc_type text,
  p_reason text, p_user uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_period date;
  v_row gst_void_invoice_numbers;
begin
  select max(s.period_month) into v_period
  from v_gst_invoice_series s
  where s.entity_key = p_entity_key and s.series_key = p_series_key and s.seq < p_seq;

  if v_period is null then
    -- No preceding number in this series (the gap is the very first number) --
    -- fall back to the earliest period this series has, rather than refuse.
    select min(s.period_month) into v_period
    from v_gst_invoice_series s
    where s.entity_key = p_entity_key and s.series_key = p_series_key;
  end if;

  insert into gst_void_invoice_numbers (entity_key, series_key, seq, doc_type, period_month, reason, recorded_by)
  values (p_entity_key, p_series_key, p_seq, coalesce(p_doc_type, 'sales'), v_period, p_reason, p_user)
  on conflict (entity_key, series_key, seq, doc_type) do update set reason = excluded.reason
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

-- v_gst_exceptions, reproduced in full (it is a single CREATE VIEW, not
-- incrementally patched elsewhere -- see 20261004_gst_exceptions_view.sql).
-- Only change: doc_series_gap excludes acknowledged numbers, and every
-- branch now carries series_key/seq (null except on doc_series_gap) so the
-- UI has enough to call gst_acknowledge_series_gap without parsing
-- record_label, which is not reliably splittable (series_key and seq are
-- both pure digit runs with nothing between them once concatenated).
drop view if exists public.v_gst_exceptions;
create view public.v_gst_exceptions as
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
select p.entity_key, p.period_month, 'bank_statement_not_uploaded', 'warning', 'document_summary',
       'series', null::uuid, to_char(p.period_month, 'Mon YYYY'),
       (p.status->>'reason'),
       null::text, null::bigint
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
       '. If this is one payment covering more than one invoice, match each portion separately from Recon Sessions.',
       null::text, null::bigint
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
  'Live GST pre-flight validation, one row per problem. Blockers must be cleared before a return is generated; warnings are advisory. Never stored -- a fixed record simply stops appearing. series_key/seq are populated only for doc_series_gap, so the UI can acknowledge one via gst_acknowledge_series_gap without parsing record_label (series_key and seq are both pure digit runs with nothing between them once concatenated, so splitting it back apart is not reliable).';

-- Table 13: fold acknowledged gaps into totnum/cancel so a number genuinely
-- consumed and cancelled outside the ERP is still reported, not omitted.
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
      'totnum', count(*) + coalesce((
        select sum(1) from gst_void_invoice_numbers v
        where v.entity_key = p_entity_key and v.series_key = s.series_key and v.doc_type = s.doc_type
          and v.period_month between date_trunc('month', p_from)::date and p_to
      ), 0),
      'cancel', count(*) filter (where s.cancelled) + coalesce((
        select sum(1) from gst_void_invoice_numbers v
        where v.entity_key = p_entity_key and v.series_key = s.series_key and v.doc_type = s.doc_type
          and v.period_month between date_trunc('month', p_from)::date and p_to
      ), 0),
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
