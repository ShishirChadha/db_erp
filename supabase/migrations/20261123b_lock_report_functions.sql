-- Close a public read of business financials (found 2026-11-23 while building
-- trade-ins). Supabase's default privileges had granted anon/authenticated
-- SELECT on the internal report/GST views and EXECUTE on the SECURITY DEFINER
-- report/GST functions, none of which check the caller. With the public anon
-- key (shipped in the website's JS) anyone could read sale lines with cost and
-- profit, stock value, receivables, expenses and GST data, or call
-- gst_acknowledge_series_gap.
--
-- Every caller in apps/erp and apps/web uses the service-role client
-- (supabaseAdmin), and report_purchase_kpis / report_web_funnel* were already
-- locked this way -- so this only finishes the intended pattern. Public
-- storefront views (public_*) are untouched.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (p.proname like 'report\_%' or p.proname like 'gst\_%' or p.proname = 'match_vendors_by_name')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
  end loop;

  for r in
    select c.oid::regclass as rel
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
      and (c.relname like 'v\_report\_%' or c.relname like 'v\_gst\_%')
  loop
    execute format('revoke all on %s from anon, authenticated', r.rel);
    execute format('grant select on %s to service_role', r.rel);
  end loop;
end $$;
