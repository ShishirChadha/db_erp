-- Close direct-database write access that bypassed every API permission check.
--
-- Before this, these tables had a single catch-all policy of `true` or
-- `role() = 'authenticated'`. Browsers hold the public anon key plus a JWT, so
-- any signed-in account -- including a self-registered website customer, who
-- shares the `authenticated` role with staff -- could read and write them
-- straight through PostgREST. sale_payments was granted to PUBLIC with `true`,
-- so even signed-out visitors could read and write payment rows.
--
-- All of these tables are written by API routes through the service-role
-- client, which bypasses RLS, so the app keeps working. Browser-side reads stay
-- available to staff (is_staff()). The only browser-side writers are the
-- owner-only Invoices/Purchases pages and the Expenses bulk-add dialog,
-- which get matching write policies below.

begin;

-- 1. Written only through API routes: staff may read, nobody writes directly.
do $$
declare
  t text;
  api_only text[] := array[
    'sales', 'sale_payments', 'invoice_sequences',
    'purchase_orders', 'purchase_order_items',
    'repair_jobs', 'repair_job_parts',
    'replacement_jobs', 'replacement_job_parts', 'replacement_job_counter',
    'accessory_replacement_jobs', 'accessory_replacement_job_parts',
    'accessory_rma_events', 'asset_rma_events',
    'asset_cost_adjustments', 'field_corrections',
    'activities', 'activity_assignees', 'activity_checklist_items',
    'activity_comments', 'activity_comment_reactions', 'activity_watchers',
    'notifications'
  ];
  p record;
begin
  foreach t in array api_only loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_staff()))',
      t || '_staff_read', t
    );
  end loop;
end $$;

-- 2. Invoices: written from the browser by owner-only invoice pages.
drop policy if exists "Enable all for authenticated users" on public.invoices;
drop policy if exists "Enable all for authenticated users" on public.invoice_items;

create policy invoices_staff_read on public.invoices
  for select to authenticated using ((select public.is_staff()));
create policy invoices_owner_insert on public.invoices
  for insert to authenticated with check ((select public.is_owner()));
create policy invoices_owner_update on public.invoices
  for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy invoices_owner_delete on public.invoices
  for delete to authenticated using ((select public.is_owner()));

create policy invoice_items_staff_read on public.invoice_items
  for select to authenticated using ((select public.is_staff()));
create policy invoice_items_owner_insert on public.invoice_items
  for insert to authenticated with check ((select public.is_owner()));
create policy invoice_items_owner_update on public.invoice_items
  for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy invoice_items_owner_delete on public.invoice_items
  for delete to authenticated using ((select public.is_owner()));

-- 3. Legacy purchases + their files: only the owner-only Purchases page uses them.
drop policy if exists "Admin full access" on public.purchases;
drop policy if exists "Admin full access" on public.purchase_files;

create policy purchases_owner_all on public.purchases
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy purchase_files_owner_all on public.purchase_files
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

-- 4. Expenses: the bulk-add dialog inserts from the browser for staff with the
-- Expenses edit grant (enforced in the UI and API). Limit to staff so website
-- customers are excluded.
drop policy if exists "Admin full access" on public.expenses;

create policy expenses_staff_all on public.expenses
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

commit;
