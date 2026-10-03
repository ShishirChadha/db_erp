-- Adds `all_tables` to monitoring_db_stats(): every public table's size/row
-- estimate, not just the top 8 `largest_tables` already returned. Same
-- catalog-only query (pg_total_relation_size + pg_stat_user_tables), just
-- without the LIMIT -- no table data is scanned, so this is as cheap as the
-- existing call. Used by the new "size by feature" breakdown on System
-- Health (apps/erp/lib/monitoring-modules.ts), computed in the Next.js route,
-- not here -- keeping the module/app attribution in TypeScript means it can
-- be corrected without a migration.
create or replace function public.monitoring_db_stats()
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'connections',    (select count(*) from pg_stat_activity where datname = current_database()),
    'max_connections',(select setting::int from pg_settings where name = 'max_connections'),
    'postgres_version',(select setting from pg_settings where name = 'server_version'),
    'largest_tables', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select c.relname as table_name,
               pg_total_relation_size(c.oid) as total_bytes,
               coalesce(s.n_live_tup, 0) as row_estimate
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_stat_user_tables s on s.relid = c.oid
        where n.nspname = 'public' and c.relkind = 'r'
        order by pg_total_relation_size(c.oid) desc
        limit 8
      ) t
    ),
    'all_tables', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select c.relname as table_name,
               pg_total_relation_size(c.oid) as total_bytes,
               coalesce(s.n_live_tup, 0) as row_estimate
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_stat_user_tables s on s.relid = c.oid
        where n.nspname = 'public' and c.relkind = 'r'
        order by pg_total_relation_size(c.oid) desc
      ) t
    ),
    'cron_jobs', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'jobname', jobname, 'schedule', schedule, 'active', active)
             order by jobname), '[]'::jsonb)
      from cron.job
    )
  );
$$;
