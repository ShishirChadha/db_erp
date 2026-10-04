-- GST filing groundwork, phase 0.
--
-- Three independent corrections, all safe to re-run:
--   1. report_gst_summary summed tax across every sale while filtering taxable
--      value to sale_type='GST', so the Reports GST tab overstated output tax.
--   2. sku_master.hsn_code was unset on most SKUs, which blocks GSTR-1 Table 12
--      (HSN summary is mandatory). Backfilled from the per-category default that
--      sku_category_templates already carries and that resolveOrCreateSku()
--      already applies to newly created SKUs.
--   3. customers.gst_treatment makes B2B-vs-B2C routing explicit instead of
--      inferring it from "is gst_number null", which cannot distinguish an
--      unregistered business from a walk-in consumer.

begin;

-- ---------------------------------------------------------------------------
-- 1. report_gst_summary: filter the tax sum the same way as taxable value.
-- ---------------------------------------------------------------------------
create or replace function public.report_gst_summary(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  result jsonb;
  not_invoiced int;
begin
  select coalesce(jsonb_agg(row_data order by row_data->>'month', row_data->>'entity'), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      'month', month_start, 'entity', coalesce(entity, 'Unknown'),
      'taxable_value', coalesce(sum(revenue_ex_gst) filter (where sale_type = 'GST'), 0),
      -- Was an unfiltered sum(gst): a Cash-type sale carrying a stray tax
      -- amount inflated the figure against a taxable value that excluded it.
      'gst', coalesce(sum(gst) filter (where sale_type = 'GST'), 0),
      'cash_revenue', coalesce(sum(revenue_incl) filter (where sale_type = 'Cash'), 0)
    ) as row_data
    from v_report_sale_lines
    where sale_date between p_from and p_to
    group by month_start, entity
  ) t;

  select count(*) into not_invoiced
  from v_report_sale_lines where sale_date between p_from and p_to and sale_type = 'GST' and not invoice_finalized;

  return jsonb_build_object('by_month_entity', result, 'gst_sales_not_invoiced', not_invoiced);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Backfill sku_master.hsn_code from the category default.
--    Treats '' and NULL alike -- both occur in this data. SERVICE is excluded
--    on purpose: those SKUs carry a SAC via sac_code_id, not an HSN, and must
--    not be given a goods code. Categories with no template default (ACC,
--    OTHER) are left alone -- they are heterogeneous buckets that need a human
--    classification, and the GST exception report surfaces them.
-- ---------------------------------------------------------------------------
update sku_master s
set hsn_code = t.default_hsn_code
from sku_category_templates t
where t.category = s.category
  and coalesce(nullif(trim(s.hsn_code), ''), null) is null
  and nullif(trim(t.default_hsn_code), '') is not null
  and s.category <> 'SERVICE';

-- ---------------------------------------------------------------------------
-- 3. customers.gst_treatment -- explicit GSTR-1 section routing.
-- ---------------------------------------------------------------------------
alter table customers
  add column if not exists gst_treatment text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customers_gst_treatment_check'
  ) then
    alter table customers add constraint customers_gst_treatment_check
      check (gst_treatment is null or gst_treatment in (
        'registered_regular', 'registered_composition',
        'unregistered_business', 'consumer', 'overseas'
      ));
  end if;
end $$;

comment on column customers.gst_treatment is
  'GSTR-1 section routing. Registered -> B2B (Table 4); unregistered/consumer -> B2CL or B2CS by value and inter/intra state; overseas -> exports. Explicit rather than derived from gst_number, because a null GSTIN cannot distinguish an unregistered business from a consumer.';

-- Seed from what is already known. A GSTIN on file means registered; anything
-- else starts as 'consumer', which is the safe default for this business
-- (walk-in retail) and is correctable per customer.
update customers
set gst_treatment = case
  when nullif(trim(coalesce(gst_number, '')), '') is not null then 'registered_regular'
  else 'consumer'
end
where gst_treatment is null;

commit;
