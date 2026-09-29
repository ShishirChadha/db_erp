-- Reconciliation query. Run on BOTH source and target and diff the output.
-- Used twice: Phase 0 (baseline) and Phase 5 (verify the restore is complete).

\echo '===== object counts ====='
select 'public functions' as object, count(*)::text as n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
union all select 'triggers (non-internal)', count(*)::text from pg_trigger where not tgisinternal
union all select 'policies (public+storage)', count(*)::text from pg_policies where schemaname in ('public','storage')
union all select 'views in public', count(*)::text from pg_views where schemaname = 'public'
union all select 'public_* storefront views', count(*)::text from pg_views where schemaname='public' and viewname like 'public!_%' escape '!'
union all select 'tables in public', count(*)::text from pg_tables where schemaname = 'public'
union all select 'cron jobs', count(*)::text from cron.job
union all select 'auth.users', count(*)::text from auth.users
union all select 'auth.users with password', count(*)::text from auth.users where encrypted_password is not null
union all select 'storage.objects', count(*)::text from storage.objects
union all select 'storage.buckets', count(*)::text from storage.buckets
order by object;

\echo ''
\echo '===== exact row count per table (largest is ~1150 rows, so exact is cheap) ====='
select table_name,
       (xpath('/row/c/text()',
         query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::bigint as rows
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;
