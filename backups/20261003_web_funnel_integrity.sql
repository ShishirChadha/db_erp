-- Website funnel data integrity.
--
-- Reports > Website's funnel numbers were not trustworthy, for four separate
-- reasons that all happen to be cheap to fix right now because `orders` and
-- `web_reservations` are both still empty (no website order has ever been
-- placed). These columns are free to add today and never will be again.
--
-- 1. cart_items has created_at but no updated_at, so bumping a quantity leaves
--    the row's only timestamp pointing at the first add. Every abandonment
--    window was therefore measured from the wrong instant.
--
-- 2. cart_items is never cleared when an order converts -- the only delete in
--    the whole app is a customer clicking remove. So a bought item sat in the
--    cart forever, and report_web_funnel counted it as abandoned in
--    perpetuity. Fixed in app code (apps/web/lib/order-to-sale.ts) alongside
--    this migration.
--
-- 3. report_web_funnel's abandonment guard was per-CUSTOMER
--    (`not exists (select 1 from orders o where o.customer_id = ci.customer_id
--    and o.created_at >= ci.created_at)`), so one past purchase exonerated
--    every cart line that customer would ever add again. It also counted
--    orders of any status as "checkout started" while comparing against
--    paid-only purchases, and divided an order count by a customer count --
--    which could produce a cart-to-checkout rate above 100%.
--
-- 4. Three different failures all collapsed into orders.status='cancelled'
--    (sold out at reserve time, Razorpay init failure, reserve RPC error), and
--    reserve_order_items' `reason:'sold_out'` was discarded by the caller. A
--    paid order whose conversion to a sale failed left only a console.error,
--    which is unqueryable -- so "money taken, bookkeeping incomplete" was
--    invisible.

begin;

-- ---------------------------------------------------------------------------
-- 1. cart_items: when was this cart last touched
-- ---------------------------------------------------------------------------
alter table public.cart_items
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_cart_items_updated_at()
returns trigger language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_cart_items_updated_at on public.cart_items;
create trigger trg_cart_items_updated_at
  before update on public.cart_items
  for each row execute function public.set_cart_items_updated_at();

-- Backfill existing rows to their real first-add date. The ADD COLUMN above
-- evaluates its default ONCE, stamping every existing row with the moment the
-- migration ran -- which would make a three-week-old cart look touched today
-- and hide it from the abandonment window entirely.
--
-- The trigger has to be disabled around this: it is BEFORE UPDATE and
-- unconditionally overwrites updated_at with now(), so a plain UPDATE reports
-- rows affected while changing nothing. (Learned the hard way.)
alter table public.cart_items disable trigger trg_cart_items_updated_at;
update public.cart_items set updated_at = created_at where updated_at <> created_at;
alter table public.cart_items enable trigger trg_cart_items_updated_at;

create index if not exists idx_cart_items_updated_at
  on public.cart_items using btree (updated_at desc);
-- The FK to customer_profiles had no index, and every cart read filters on it.
create index if not exists idx_cart_items_customer_id
  on public.cart_items using btree (customer_id);

comment on column public.cart_items.updated_at is
  'Last time this line was added to or had its quantity changed. created_at is '
  'first-add only, which made every cart-age/abandonment window wrong.';

-- ---------------------------------------------------------------------------
-- 2. web_reservations: WHY the hold ended
-- ---------------------------------------------------------------------------
-- release_expired_reservations() and convertOrderToSales both stamp
-- released_at, so converted / expired / aborted were indistinguishable from a
-- column read -- you had to join order_items.erp_sale_id and guess from
-- timestamps. An explicit reason makes the ERP's reservation history readable.
alter table public.web_reservations
  add column if not exists release_reason text;

alter table public.web_reservations
  drop constraint if exists web_reservations_release_reason_check;
alter table public.web_reservations
  add constraint web_reservations_release_reason_check
  check (release_reason is null or release_reason in
         ('converted','expired','aborted_sold_out','aborted_payment_init'));

comment on column public.web_reservations.release_reason is
  'Why released_at was set: converted (became a sale), expired (TTL swept by '
  'cron), or aborted_* (checkout failed synchronously). NULL while the hold is '
  'still active.';

-- ---------------------------------------------------------------------------
-- 3. orders: why it was cancelled, and why conversion failed
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists cancel_reason text,
  add column if not exists conversion_error text,
  add column if not exists conversion_failed_at timestamptz;

alter table public.orders drop constraint if exists orders_cancel_reason_check;
alter table public.orders add constraint orders_cancel_reason_check
  check (cancel_reason is null or cancel_reason in
         ('sold_out','payment_init_failed','reserve_error','customer_abandoned'));

comment on column public.orders.cancel_reason is
  'Which failure produced status=''cancelled''. Sold-out-at-checkout was '
  'previously unrecoverable: reserve_order_items returns reason:''sold_out'' and '
  'the caller discarded it.';
comment on column public.orders.conversion_error is
  'The webhook''s conversion failure, persisted. Authoritative detection is '
  'still derived (status=''paid'' with an order_item lacking erp_sale_id) so it '
  'survives a lost log line; this column is the human-readable why.';

create index if not exists idx_orders_created_at on public.orders using btree (created_at desc);
create index if not exists idx_orders_customer_id on public.orders using btree (customer_id);
create index if not exists idx_orders_status_paid_at on public.orders using btree (status, paid_at desc);

-- ---------------------------------------------------------------------------
-- 4. customer_profiles: let staff read web accounts
-- ---------------------------------------------------------------------------
-- The table only had `id = auth.uid()` policies, so the ERP's Customers page
-- (which queries client-direct) silently got nothing back when joining it --
-- which is why a web customer has never been distinguishable from a walk-in.
-- Safe to widen: a storefront customer has no `profiles` row, so is_staff() is
-- false for them and they still only ever see themselves.
drop policy if exists "Staff can view customer profiles" on public.customer_profiles;
create policy "Staff can view customer profiles" on public.customer_profiles
  for select to authenticated
  using (( select public.is_staff() ) or id = ( select auth.uid() ));

commit;

-- ===========================================================================
-- 5. The corrected funnel RPCs
-- ===========================================================================

begin;

create or replace function public.report_web_funnel(
  p_from date, p_to date, p_abandon_hours integer default 24
) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  cart_customers       bigint;
  cart_events          bigint;
  checkout_customers   bigint;
  checkout_started     bigint;
  purchased_orders     bigint;
  purchased_customers  bigint;
  abandoned_customers  bigint;
  abandoned_value      numeric;
  sold_out_at_checkout bigint;
  paid_unconverted     bigint;
begin
  -- Measured on updated_at, not created_at: bumping a quantity is cart
  -- activity, and before this migration there was no way to see it at all.
  select count(distinct customer_id), count(*)
    into cart_customers, cart_events
    from cart_items
   where updated_at::date between p_from and p_to;

  -- Still counts every status -- starting a checkout and then failing IS a
  -- checkout start. What changed is that the rates below no longer mix units.
  select count(*), count(distinct customer_id)
    into checkout_started, checkout_customers
    from orders
   where created_at::date between p_from and p_to;

  select count(*), count(distinct customer_id)
    into purchased_orders, purchased_customers
    from orders
   where status = 'paid' and paid_at::date between p_from and p_to;

  -- Abandonment, corrected on three counts:
  --   (1) per-ITEM, not per-customer. The old guard meant a single past
  --       purchase exonerated every cart line that customer ever added again.
  --   (2) measured from updated_at, so a cart touched five minutes ago is not
  --       reported as abandoned three weeks ago.
  --   (3) only counts carts that still exist, now that order-to-sale deletes
  --       converted lines -- a bought item can no longer sit here forever.
  select count(distinct ci.customer_id),
         coalesce(sum(ci.quantity * coalesce(pp.web_price, 0)), 0)
    into abandoned_customers, abandoned_value
    from cart_items ci
    left join public_products pp on pp.id = ci.sku_id
   where ci.updated_at::date between p_from and p_to
     and ci.updated_at <= now() - (p_abandon_hours || ' hours')::interval
     and not exists (
       select 1
         from orders o
         join order_items oi on oi.order_id = o.id
        where o.customer_id = ci.customer_id
          and o.status = 'paid'
          and oi.sku_id = ci.sku_id
          and oi.selected_upgrades = ci.selected_upgrades
          and o.created_at >= ci.updated_at
     );

  -- Recoverable now that /api/checkout/start persists cancel_reason.
  select count(*) into sold_out_at_checkout
    from orders
   where created_at::date between p_from and p_to
     and status = 'cancelled' and cancel_reason = 'sold_out';

  -- Money taken, ERP bookkeeping incomplete. Derived rather than a status
  -- column, so it cannot drift out of sync with the actual order_items.
  select count(*) into paid_unconverted
    from orders o
   where o.status = 'paid'
     and o.paid_at::date between p_from and p_to
     and exists (select 1 from order_items oi
                  where oi.order_id = o.id and oi.erp_sale_id is null);

  return jsonb_build_object(
    'cart_customers',            cart_customers,
    'cart_events',               cart_events,
    'checkout_customers',        checkout_customers,
    'checkout_started',          checkout_started,
    'purchased_orders',          purchased_orders,
    'purchased_customers',       purchased_customers,
    -- Deprecated alias. reports-client.tsx reads funnel.purchased; renaming it
    -- outright would silently blank that tile. Remove once the client is
    -- updated to purchased_orders.
    'purchased',                 purchased_orders,
    -- orders -> orders
    'checkout_to_purchase_rate',
      case when checkout_started > 0
           then round(100.0 * purchased_orders / checkout_started, 1) end,
    -- customers -> customers. The old version divided an order count by a
    -- customer count, which could exceed 100%.
    'cart_to_checkout_rate',
      case when cart_customers > 0
           then round(100.0 * checkout_customers / cart_customers, 1) end,
    'abandoned_cart_customers',  abandoned_customers,
    'abandoned_cart_value',      abandoned_value,
    'sold_out_at_checkout',      sold_out_at_checkout,
    'paid_not_converted',        paid_unconverted,
    'abandon_threshold_hours',   p_abandon_hours
  );
end;
$$;

revoke all on function public.report_web_funnel(date, date, integer) from public, anon, authenticated;
grant all on function public.report_web_funnel(date, date, integer) to service_role;

-- Same updated_at basis and paid-only purchase filter as the tiles above, so
-- the chart and the tiles cannot disagree.
create or replace function public.report_web_funnel_timeseries(p_from date, p_to date)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  result jsonb;
begin
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  ),
  carts as (
    select updated_at::date as d, count(distinct customer_id) as n
    from cart_items where updated_at::date between p_from and p_to
    group by 1
  ),
  starts as (
    select created_at::date as d, count(*) as n
    from orders where created_at::date between p_from and p_to
    group by 1
  ),
  purchases as (
    select paid_at::date as d, count(*) as n
    from orders where status = 'paid' and paid_at::date between p_from and p_to
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', days.d,
    'cart_customers', coalesce(carts.n, 0),
    'checkout_started', coalesce(starts.n, 0),
    'purchased', coalesce(purchases.n, 0)
  ) order by days.d), '[]'::jsonb)
  into result
  from days
  left join carts on carts.d = days.d
  left join starts on starts.d = days.d
  left join purchases on purchases.d = days.d;

  return result;
end;
$$;

revoke all on function public.report_web_funnel_timeseries(date, date) from public, anon, authenticated;
grant all on function public.report_web_funnel_timeseries(date, date) to service_role;

commit;
-- release_expired_reservations(): stamp WHY the hold ended.
--
-- This and convertOrderToSales both set released_at, so expired / converted /
-- aborted were indistinguishable from a column read. Only the UPDATE's SET
-- list changes; the atomic-claim idiom (UPDATE ... RETURNING as the loop's own
-- row source) and the guarded asset revert are untouched.
create or replace function public.release_expired_reservations() returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  released record;
  affected_order_ids uuid[] := '{}';
begin
  for released in
    update web_reservations
       set released_at = now(), release_reason = 'expired'
     where released_at is null and expires_at <= now()
    returning id, order_item_id, asset_id, previous_asset_status
  loop
    if released.asset_id is not null then
      update asset_ledger
         set status = coalesce(released.previous_asset_status, 'ready_for_sale')
       where id = released.asset_id and status = 'reserved_web';
    end if;
    affected_order_ids := affected_order_ids || (select order_id from order_items where id = released.order_item_id);
  end loop;

  update orders
     set status = 'expired'
   where id = any(affected_order_ids) and status = 'pending_payment';
end;
$$;

revoke all on function public.release_expired_reservations() from public, anon, authenticated;
grant all on function public.release_expired_reservations() to service_role;
