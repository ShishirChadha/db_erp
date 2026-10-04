-- GSTR-1 outward supply lines: one row per invoice_items row, enriched with
-- everything the return needs and that v_report_sale_lines cannot reach
-- (it carries no invoice_id, hsn_code or customer GSTIN).
--
-- Keyed on invoices.invoice_date, which is the legally correct date for a
-- return and incidentally avoids the sale_date/effective_sale_date drift.

begin;

-- Replaced in place, not dropped: v_gst_exceptions reads from this view, so a
-- DROP would need CASCADE and would take the exceptions view with it. CREATE OR
-- REPLACE is safe here because the column list is unchanged -- if a future
-- change needs to add or reorder a column, drop both views and recreate them in
-- order rather than reaching for CASCADE.
create or replace view public.v_gst_outward_lines as
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
  -- Place of supply: the stored value, else the customer's GSTIN prefix, else
  -- the seller's own state. Same precedence as classifyGst().
  coalesce(
    nullif(trim(coalesce(i.place_of_supply, '')), ''),
    substr(nullif(trim(coalesce(i.customer_gst, '')), ''), 1, 2),
    e.state_code
  )                                          as pos,
  li.id                                      as line_id,
  li.item_type,
  li.description,
  -- HSN resolution, in precedence order:
  --   1. the invoice line's own code -- the authoritative snapshot of what was
  --      actually billed, and the only correct source for a filed period;
  --   2. the SKU's current HSN -- most historical lines were written before
  --      HSN was captured, and without this fallback Table 12 reports only a
  --      fraction of the taxable value while Tables 4/5/7 report all of it,
  --      which is exactly the mismatch the portal now cross-validates;
  --   3. the SKU's SAC, for services (Table 12 takes SAC under HSN prefix 99).
  -- Nothing is rewritten on the stored invoice; this resolves at report time.
  --   4. for a service line that reaches no SKU at all, the business's own
  --      registered SAC for that service. The historical repair lines carry
  --      neither sku_id nor accessory_id (they predate repair charges being
  --      SKU-backed), so nothing above can resolve them. Both codes below are
  --      already rows in sac_codes -- this reads the business's own
  --      classification rather than inventing one.
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
  -- Services carry a SAC (HSN prefix 99 in Table 12); goods carry an HSN.
  (li.item_type in ('repair', 'rental'))     as is_service,
  coalesce(li.quantity, 1)                   as quantity,
  coalesce(li.rate, 0)                       as rate,
  coalesce(li.gst_rate, 0)                   as rt,
  round(coalesce(li.quantity, 1) * coalesce(li.rate, 0), 2) as txval,
  coalesce(li.cgst_amount, 0)                as camt,
  coalesce(li.sgst_amount, 0)                as samt,
  coalesce(li.igst_amount, 0)                as iamt,
  0::numeric                                 as csamt,
  -- A registered recipient makes the supply B2B regardless of value.
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
      -- B2CL threshold is date-aware: raised to 1,00,000 from the August 2024
      -- return period (Notification 12/2024-CT); 2,50,000 before that. A
      -- historical period must be classified by the rule in force then.
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
       then 'INTRA' else 'INTER' end         as sply_ty
from invoices i
  join ent e on e.key = i.entity_key
  join invoice_items li on li.invoice_id = i.id
  left join customers c on c.id = i.customer_id
  -- invoice_items points at the SKU via sku_id for assets and accessory_id for
  -- accessory/service lines; either one identifies the sku_master row.
  left join sku_master sk on sk.id = coalesce(li.sku_id, li.accessory_id)
  left join sac_codes sac on sac.id = sk.sac_code_id
where coalesce(i.is_deleted, false) = false
  and coalesce(i.invoice_type, 'sales') = 'sales'
  and e.is_gst_registered;

comment on view public.v_gst_outward_lines is
  'GSTR-1 outward supply grain: one row per invoice line for GST-registered entities, with place of supply, tax heads and section routing (b2b/b2cl/b2cs) resolved. B2CL threshold is date-aware per Notification 12/2024-CT.';

commit;
