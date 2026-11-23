-- Trade-ins (2026-11-23): a customer hands an old laptop back as part-payment
-- on a sale ("upgrade": we buy the old one at a price we set, sell the new one
-- at full price, the customer pays the difference).
--
-- Different from a replacement job on purpose: the old unit's own sale is NOT
-- cancelled (it happened, and was usually GST-filed), and the value given for
-- the old unit becomes that unit's cost for its next sale. The value is settled
-- against the new sale as a sale_payments row on the non-cash account
-- 'Trade-in' (never matched to a bank -- recon only looks at entity accounts).
--
-- asset_ledger.cost_price keeps meaning "what we paid the vendor", so a PO
-- attached later for the unit's first purchase can't overwrite the trade-in
-- cost. The current life's cost lives in asset_ledger.trade_in_value (written
-- only by /api/trade-ins create/undo), and the profit view picks the right
-- cost per sale from trade_ins by time.

create table if not exists public.trade_in_counter (
  year text primary key,
  last_number integer not null default 0
);
alter table public.trade_in_counter enable row level security;
revoke all on public.trade_in_counter from anon, authenticated;

create or replace function public.generate_trade_in_number()
returns text
language plpgsql
as $$
declare
  cur_year text := to_char(current_date, 'YY');
  next_num integer;
begin
  insert into public.trade_in_counter (year, last_number)
  values (cur_year, 1)
  on conflict (year) do update set last_number = trade_in_counter.last_number + 1
  returning last_number into next_num;
  return 'TRD-' || cur_year || '-' || lpad(next_num::text, 3, '0');
end;
$$;
revoke execute on function public.generate_trade_in_number() from public, anon, authenticated;
grant execute on function public.generate_trade_in_number() to service_role;

create table if not exists public.trade_ins (
  id uuid primary key default gen_random_uuid(),
  trade_in_number text not null unique,
  trade_in_date date not null default current_date,
  customer_id uuid not null references public.customers(id),
  -- The physical unit that came in: its existing row when it was ours
  -- (was_our_unit), or a new row created by the trade-in.
  asset_id uuid not null references public.asset_ledger(id),
  was_our_unit boolean not null,
  previous_sale_id uuid references public.sales(id),
  previous_qc_status text,
  -- The sale the value is settled against, and the 'Trade-in' payment row.
  sale_id uuid not null references public.sales(id),
  sale_payment_id uuid references public.sale_payments(id) on delete set null,
  value numeric not null check (value > 0),
  -- The entity that bought the unit back: always the sale's own entity.
  payment_account text not null check (payment_account in ('Digitalbluez', 'Techtenth', 'Cash')),
  condition_notes text,
  accessories_included text,
  -- For the buyback slip. Only the ID's type and last 4 characters, never the
  -- full Aadhaar/PAN number.
  id_proof_type text,
  id_proof_last4 text check (id_proof_last4 is null or id_proof_last4 ~ '^[A-Za-z0-9]{4}$'),
  notes text,
  entered_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text
);
create index if not exists idx_trade_ins_asset_id on public.trade_ins (asset_id);
create index if not exists idx_trade_ins_sale_id on public.trade_ins (sale_id);
create index if not exists idx_trade_ins_customer_id on public.trade_ins (customer_id);
create index if not exists idx_trade_ins_previous_sale_id on public.trade_ins (previous_sale_id);
create index if not exists idx_trade_ins_sale_payment_id on public.trade_ins (sale_payment_id);
create index if not exists idx_trade_ins_entered_by on public.trade_ins (entered_by);
create index if not exists idx_trade_ins_voided_by on public.trade_ins (voided_by);

-- Values are a purchase cost: owner-only even for a direct client read (the
-- app itself reads through the service role, gated per route).
alter table public.trade_ins enable row level security;
revoke all on public.trade_ins from anon;
drop policy if exists trade_ins_owner_read on public.trade_ins;
create policy trade_ins_owner_read on public.trade_ins
  for select to authenticated using ((select public.is_owner()));

alter table public.asset_ledger
  add column if not exists trade_in_value numeric,
  add column if not exists traded_in_at timestamptz,
  add column if not exists from_trade_in boolean not null default false;

-- ---------------------------------------------------------------- profit per sale
-- Same view as before, except a unit's cost is now chosen per "life": a sale
-- made after a trade-in costs the trade-in value (plus cost adjustments made
-- after it); a sale made before one keeps the original purchase cost (plus
-- adjustments made before the next trade-in). No trade-ins = identical to before.
create or replace view public.v_report_sale_lines as
 SELECT s.id,
    s.sale_date,
    report_fy(s.sale_date) AS fy,
    date_trunc('month'::text, s.sale_date::timestamp with time zone)::date AS month_start,
    s.payment_account AS entity,
    s.sale_type,
    COALESCE(s.sale_base_price, 0::numeric) AS revenue_ex_gst,
    COALESCE(s.sale_gst, 0::numeric) AS gst,
    COALESCE(s.sale_total, 0::numeric) AS revenue_incl,
    COALESCE(s.accessory_quantity, 1) AS units,
    s.customer_id,
    COALESCE(c.customer_name, s.customer_name, 'Unknown'::text) AS customer_name_canonical,
    COALESCE(NULLIF(TRIM(BOTH FROM s.sold_by), ''::text), 'Unknown'::text) AS sold_by_canonical,
    COALESCE(sku_a.brand, sku_b.brand) AS brand,
    COALESCE(sku_a.category, sku_b.category) AS category,
        CASE
            WHEN s.accessory_id IS NOT NULL AND sku_b.category = 'SERVICE'::text AND s.repair_job_id IS NOT NULL THEN 'repair'::text
            WHEN s.accessory_id IS NOT NULL AND sku_b.category = 'SERVICE'::text AND s.rental_agreement_id IS NOT NULL THEN 'rental'::text
            WHEN s.accessory_id IS NOT NULL THEN 'accessory'::text
            WHEN s.asset_ledger_id IS NOT NULL THEN 'unit'::text
            WHEN s.repair_job_id IS NOT NULL THEN 'repair'::text
            WHEN s.rental_agreement_id IS NOT NULL THEN 'rental'::text
            ELSE 'other'::text
        END AS line_kind,
    s.asset_ledger_id,
    a.asset_number,
    a.serial_number,
    COALESCE(s.amount_paid, 0::numeric) AS amount_paid,
    GREATEST(COALESCE(s.sale_total, 0::numeric) - COALESCE(s.amount_paid, 0::numeric), 0::numeric) AS outstanding,
    s.payment_status,
    s.finalized AS invoice_finalized,
    s.entered_by,
    s.created_at,
    cogs_resolved.cogs,
    cogs_resolved.cogs_known,
    COALESCE(sku_a.id, sku_b.id) AS sku_id,
    COALESCE(sku_a.sku_description, sku_a.full_sku_code, sku_b.sku_description, sku_b.full_sku_code) AS sku_label
   FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN asset_ledger a ON a.id = s.asset_ledger_id
     LEFT JOIN sku_master sku_a ON sku_a.id = a.sku_id
     LEFT JOIN sku_master sku_b ON sku_b.id = s.accessory_id
     LEFT JOIN LATERAL ( SELECT t.value, t.created_at
           FROM trade_ins t
          WHERE a.id IS NOT NULL AND t.asset_id = a.id AND t.voided_at IS NULL AND t.created_at <= s.created_at
          ORDER BY t.created_at DESC
         LIMIT 1) ti_prev ON true
     LEFT JOIN LATERAL ( SELECT t.created_at
           FROM trade_ins t
          WHERE a.id IS NOT NULL AND t.asset_id = a.id AND t.voided_at IS NULL AND t.created_at > s.created_at
          ORDER BY t.created_at
         LIMIT 1) ti_next ON true
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN a.id IS NOT NULL AND ti_prev.value IS NOT NULL THEN ti_prev.value + COALESCE(( SELECT sum(ac.amount) AS sum
                       FROM asset_cost_adjustments ac
                      WHERE ac.asset_id = a.id AND ac.created_at > ti_prev.created_at AND (ti_next.created_at IS NULL OR ac.created_at < ti_next.created_at)), 0::numeric)
                    WHEN a.id IS NOT NULL THEN COALESCE(NULLIF(a.cost_price, 0::numeric) + COALESCE(( SELECT sum(ac.amount) AS sum
                       FROM asset_cost_adjustments ac
                      WHERE ac.asset_id = a.id AND (ti_next.created_at IS NULL OR ac.created_at < ti_next.created_at)), 0::numeric), NULLIF(( SELECT poi.unit_price
                       FROM purchase_order_items poi
                      WHERE poi.id = a.po_item_id), 0::numeric), NULLIF(( SELECT p.total_price
                       FROM purchases p
                      WHERE p.serial_number IS NOT NULL AND a.serial_number IS NOT NULL AND lower(TRIM(BOTH FROM p.serial_number)) = lower(TRIM(BOTH FROM a.serial_number)) AND NOT COALESCE(p.is_deleted, false)
                      ORDER BY p.created_at
                     LIMIT 1), 0::numeric))
                    WHEN s.accessory_id IS NOT NULL THEN NULLIF(( SELECT sm.unit_price
                       FROM stock_movements sm
                      WHERE sm.sku_id = s.accessory_id AND sm.movement_type = 'receipt'::movement_type_enum AND sm.unit_price > 0::numeric
                      ORDER BY sm.created_at DESC
                     LIMIT 1), 0::numeric)
                    ELSE NULL::numeric
                END AS cogs_raw) cogs_calc ON true
     CROSS JOIN LATERAL ( SELECT COALESCE(cogs_calc.cogs_raw, 0::numeric) * COALESCE(s.accessory_quantity, 1)::numeric AS cogs,
            cogs_calc.cogs_raw IS NOT NULL AS cogs_known) cogs_resolved
  WHERE NOT COALESCE(s.is_deleted, false);

-- ---------------------------------------------------------------- stock value
-- A unit back in stock from a trade-in is valued at the trade-in value (plus
-- adjustments made since), and its age counts from the trade-in.
create or replace view public.v_report_inventory_units as
 SELECT a.id,
    a.sku_id,
    sm.brand,
    sm.category,
    sm.model_name,
    a.status,
        CASE
            WHEN a.status = ANY (ARRAY['ready_for_sale'::text, 'qc_passed'::text]) THEN 'sellable'::text
            WHEN a.status = 'sold'::text THEN 'sold'::text
            WHEN a.status = ANY (ARRAY['faulty'::text, 'scrapped'::text]) THEN 'faulty'::text
            WHEN a.status = ANY (ARRAY['rma_sent'::text, 'rma_returned'::text]) THEN 'rma'::text
            ELSE 'on_hand'::text
        END AS status_bucket,
    a.source,
    a.po_id,
    a.asset_number,
    a.serial_number,
    COALESCE(a.traded_in_at, a.received_at, a.created_at) AS intake_at,
    EXTRACT(day FROM now() - COALESCE(a.traded_in_at, a.received_at, a.created_at))::integer AS age_days,
        CASE
            WHEN a.trade_in_value IS NOT NULL THEN a.trade_in_value + COALESCE(( SELECT sum(ac.amount) AS sum
               FROM asset_cost_adjustments ac
              WHERE ac.asset_id = a.id AND ac.created_at > a.traded_in_at), 0::numeric)
            ELSE NULLIF(a.cost_price, 0::numeric) + COALESCE(( SELECT sum(ac.amount) AS sum
               FROM asset_cost_adjustments ac
              WHERE ac.asset_id = a.id), 0::numeric)
        END AS cost_price,
    (a.trade_in_value IS NOT NULL OR NULLIF(a.cost_price, 0::numeric) IS NOT NULL) AS cost_known,
    sm.selling_price_default,
    a.sold_at,
    (EXISTS ( SELECT 1
           FROM sales s
          WHERE s.asset_ledger_id = a.id AND NOT COALESCE(s.is_deleted, false))) AS has_sale_row
   FROM asset_ledger a
     LEFT JOIN sku_master sm ON sm.id = a.sku_id
  WHERE NOT COALESCE(a.is_deleted, false);
