-- Credit notes.
--
-- invoices.invoice_type already permitted 'credit_note' with no code behind it.
-- This gives it a number series, a place in GSTR-1 (Table 9B CDNR/CDNUR), a row
-- in Table 13, and -- the part easiest to get wrong -- the right SIGN
-- everywhere else.
--
-- Amounts are stored POSITIVE on a credit note, exactly like an invoice. The
-- portal wants positive values in cdnr, while Table 12 and 3B 3.1(a) must be
-- NET of credit notes. So the view carries a `sign` (+1 / -1) and a signed
-- taxable value: netting consumers use the signed columns, the CDNR section
-- uses the raw ones. Storing negatives instead would have inverted the cdnr
-- output and silently understated the credit.

begin;

-- Its own series: a credit note is a different document nature in Table 13
-- (doc_num 5), and sharing the invoice series would corrupt both ranges.
alter table business_profiles add column if not exists credit_note_prefix text default 'CN';

comment on column business_profiles.credit_note_prefix is
  'Prefix for the credit-note number series. Separate from invoice_prefix because a credit note is its own document nature in GSTR-1 Table 13 and needs its own consecutive range.';

create or replace function public.next_document_number(p_entity_key text, p_doc_type text, p_financial_year text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_prefix text;
  v_format text;
  v_next integer;
  v_fy_display text;
  v_result text;
BEGIN
  IF p_doc_type = 'quotation' THEN
    SELECT quotation_prefix, invoice_number_format INTO v_prefix, v_format FROM business_profiles WHERE key = p_entity_key;
  ELSIF p_doc_type = 'proforma' THEN
    SELECT proforma_prefix, invoice_number_format INTO v_prefix, v_format FROM business_profiles WHERE key = p_entity_key;
  ELSIF p_doc_type = 'credit_note' THEN
    SELECT credit_note_prefix, invoice_number_format INTO v_prefix, v_format FROM business_profiles WHERE key = p_entity_key;
  ELSE
    SELECT invoice_prefix, invoice_number_format INTO v_prefix, v_format FROM business_profiles WHERE key = p_entity_key;
  END IF;

  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'No document prefix configured for entity % and type %', p_entity_key, p_doc_type;
  END IF;

  INSERT INTO invoice_sequences (entity_key, doc_type, financial_year, last_number, prefix)
  VALUES (p_entity_key, p_doc_type, p_financial_year, 1, NULL)
  ON CONFLICT (entity_key, doc_type, financial_year)
  DO UPDATE SET last_number = invoice_sequences.last_number + 1
  RETURNING last_number INTO v_next;

  v_fy_display := replace(p_financial_year, '-', '/');

  v_result := replace(v_format, '{prefix}', v_prefix);
  v_result := replace(v_result, '{fy}', v_fy_display);
  v_result := replace(v_result, '{seq:5}', lpad(v_next::text, 5, '0'));

  RETURN v_result;
END;
$function$;

-- Links a credit note back to what it reverses. GSTR-1's cdnr section dropped
-- the original-invoice reference in a 2018 schema revision, but we still need
-- it internally to stop the same invoice being credited twice.
alter table invoices add column if not exists credit_note_of_invoice_id uuid references invoices(id);
alter table invoices add column if not exists credit_note_reason text;

comment on column invoices.credit_note_of_invoice_id is
  'The invoice this credit note reverses. GSTR-1 does not carry it (the reference was removed from cdnr in 2018) but it prevents double-crediting and makes the audit trail legible.';

create index if not exists invoices_credit_note_of_idx on invoices (credit_note_of_invoice_id);

-- Both views are rebuilt: a column is added mid-list and credit notes join the
-- row set, so CREATE OR REPLACE cannot do it. Dropped in dependency order,
-- never CASCADE.
drop view if exists public.v_gst_exceptions;
drop view if exists public.v_gst_outward_lines;

create view public.v_gst_outward_lines as
with ent as (
  select key, state_code, gstin, is_gst_registered from business_profiles
)
select
  i.entity_key,
  e.state_code                               as entity_state_code,
  i.invoice_date,
  date_trunc('month', i.invoice_date)::date  as period_month,
  i.id                                       as invoice_id,
  i.invoice_number,
  i.source,
  coalesce(i.grand_total, 0)                 as invoice_value,
  i.customer_id,
  coalesce(i.customer_name, 'Unknown')       as customer_name,
  nullif(trim(coalesce(i.customer_gst, '')), '') as customer_gstin,
  c.gst_treatment,
  coalesce(
    nullif(trim(coalesce(i.place_of_supply, '')), ''),
    substr(nullif(trim(coalesce(i.customer_gst, '')), ''), 1, 2),
    e.state_code
  )                                          as pos,
  li.id                                      as line_id,
  li.item_type,
  li.description,
  coalesce(
    nullif(trim(coalesce(li.hsn_code, '')), ''),
    nullif(trim(coalesce(sk.hsn_code, '')), ''),
    nullif(trim(coalesce(sac.code, '')), ''),
    case li.item_type
      when 'repair' then (select code from sac_codes where code = '998713' and is_active limit 1)
      when 'rental' then (select code from sac_codes where code = '997315' and is_active limit 1)
    end
  )                                          as hsn_code,
  (nullif(trim(coalesce(li.hsn_code, '')), '') is null
   and nullif(trim(coalesce(sk.hsn_code, '')), '') is not null) as hsn_from_sku_fallback,
  (li.item_type in ('repair', 'rental'))     as is_service,
  coalesce(li.quantity, 1)                   as quantity,
  coalesce(li.rate, 0)                       as rate,
  coalesce(li.gst_rate, 0)                   as rt,
  round(coalesce(li.quantity, 1) * coalesce(li.rate, 0), 2) as txval,
  coalesce(li.cgst_amount, 0)                as camt,
  coalesce(li.sgst_amount, 0)                as samt,
  coalesce(li.igst_amount, 0)                as iamt,
  0::numeric                                 as csamt,
  (nullif(trim(coalesce(i.customer_gst, '')), '') is not null) as is_b2b,
  (coalesce(
     nullif(trim(coalesce(i.place_of_supply, '')), ''),
     substr(nullif(trim(coalesce(i.customer_gst, '')), ''), 1, 2),
     e.state_code
   ) = e.state_code)                         as is_intra_state,
  case
    when nullif(trim(coalesce(i.customer_gst, '')), '') is not null then 'b2b'
    when coalesce(
           nullif(trim(coalesce(i.place_of_supply, '')), ''),
           e.state_code
         ) <> e.state_code
      and coalesce(i.grand_total, 0) > (
        case when i.invoice_date >= date '2024-08-01' then 100000 else 250000 end
      )
      then 'b2cl'
    else 'b2cs'
  end                                        as gstr1_section,
  case when coalesce(
              nullif(trim(coalesce(i.place_of_supply, '')), ''),
              substr(nullif(trim(coalesce(i.customer_gst, '')), ''), 1, 2),
              e.state_code
            ) = e.state_code
       then 'INTRA' else 'INTER' end         as sply_ty,
  -- New: which kind of document this line belongs to, and the sign it carries
  -- when netting. A credit note reduces the supply, so anything that must be
  -- NET (Table 12, 3B 3.1(a), books-vs-return) multiplies by this; the cdnr
  -- section uses the unsigned columns, because the portal wants positives there.
  coalesce(i.invoice_type, 'sales')          as doc_type,
  case when coalesce(i.invoice_type, 'sales') = 'credit_note' then -1 else 1 end as sign,
  round(coalesce(li.quantity, 1) * coalesce(li.rate, 0), 2)
    * (case when coalesce(i.invoice_type, 'sales') = 'credit_note' then -1 else 1 end) as txval_signed,
  coalesce(li.cgst_amount, 0) * (case when coalesce(i.invoice_type, 'sales') = 'credit_note' then -1 else 1 end) as camt_signed,
  coalesce(li.sgst_amount, 0) * (case when coalesce(i.invoice_type, 'sales') = 'credit_note' then -1 else 1 end) as samt_signed,
  coalesce(li.igst_amount, 0) * (case when coalesce(i.invoice_type, 'sales') = 'credit_note' then -1 else 1 end) as iamt_signed
from invoices i
  join ent e on e.key = i.entity_key
  join invoice_items li on li.invoice_id = i.id
  left join customers c on c.id = i.customer_id
  left join sku_master sk on sk.id = coalesce(li.sku_id, li.accessory_id)
  left join sac_codes sac on sac.id = sk.sac_code_id
where coalesce(i.is_deleted, false) = false
  and coalesce(i.invoice_type, 'sales') in ('sales', 'credit_note')
  and e.is_gst_registered;

comment on view public.v_gst_outward_lines is
  'GSTR-1 outward grain: invoice and credit-note lines for GST-registered entities, with place of supply, tax heads and section routing resolved. Amounts are positive as stored; use the *_signed columns anywhere the figure must be net of credit notes.';

commit;
