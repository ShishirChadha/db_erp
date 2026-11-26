-- Three tables had no RLS, and many SECURITY DEFINER functions (which skip RLS and
-- do no caller check) were executable with the public anon key. Every app caller
-- uses the service-role client and cron runs as a database admin.
-- is_owner/is_staff/is_manager_or_above stay public: RLS policies evaluate them.

begin;

alter table public.repair_job_counter enable row level security;
alter table public.sale_refunds enable row level security;
alter table public.customer_credit_ledger enable row level security;
revoke all on public.repair_job_counter, public.sale_refunds, public.customer_credit_ledger from anon, authenticated;

do $$
declare f regprocedure;
begin
  for f in
    select oid::regprocedure from pg_proc
    where pronamespace = 'public'::regnamespace and proname in (
      'apply_backup_restore', 'bible_introspect_rpcs', 'bible_introspect_schema',
      'bible_introspect_status_values', 'dispatch_digests', 'generate_backup_snapshot',
      'generate_po_number', 'generate_repair_job_number', 'is_period_locked',
      'match_customers_by_name', 'next_document_number', 'prune_cron_history',
      'reserve_assets', 'reserve_order_items', 'run_scheduled_backup',
      'run_website_health_check', 'scan_activity_due_dates', 'scan_recurring_expenses',
      'scan_rental_cycles', 'update_backup_settings')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
