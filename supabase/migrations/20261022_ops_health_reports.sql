begin;

-- Daily health & speed reports for the storefront and the ERP.
--
-- A Claude Code cloud routine ("Daily health report", 18:00 IST) probes the
-- public sites from outside, reads ops_health_snapshot() through the ERP's
-- token-gated /api/ops/health/snapshot, and posts a structured report back to
-- /api/ops/health/reports, which stores it here, emails it and notifies the
-- owner. The owner approves or rejects each finding on System Health; a second
-- routine ("Apply approved health fixes", 10:00 + 15:00 IST) turns approved
-- code findings into GitHub PRs. Merging a PR is what deploys -- nothing here
-- ever changes production code by itself.
--
-- Two layers because the cloud routine cannot reach the ProDesk (Tailscale-
-- only for SSH/psql): everything only the database can see is gathered by the
-- SECURITY DEFINER snapshot below and handed out through the ERP.
--
-- No anon/authenticated grants and RLS with no policies, same lockdown as
-- server_metrics / server_commands -- only the ERP's service-role client and
-- supabase_admin touch these.

create table if not exists public.ops_health_reports (
  id uuid primary key default gen_random_uuid(),
  -- One report per IST day: a retried run replaces the day's report instead of
  -- stacking a second one.
  report_date date not null unique,
  overall text not null check (overall in ('healthy', 'watch', 'act')),
  summary text not null,
  -- Raw probe + snapshot numbers, kept so tomorrow's run can compare against
  -- today's (trend detection is the agent's job, not SQL's).
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ops_health_findings (
  id uuid primary key default gen_random_uuid(),
  -- The report that most recently saw this finding. A recurring issue keeps
  -- one row (see the partial unique index below) and moves forward with it.
  report_id uuid not null references public.ops_health_reports(id) on delete cascade,
  -- Stable slug chosen by the agent (e.g. 'storefront-home-cache-miss') so the
  -- same issue on a later day is recognised as the same issue.
  ref text not null,
  severity text not null check (severity in ('act', 'watch', 'info')),
  area text not null check (area in ('storefront', 'erp', 'database', 'server', 'infra')),
  title text not null,
  evidence text,
  suggestion text,
  fix_kind text not null check (fix_kind in ('code', 'db', 'infra', 'config')),
  status text not null default 'proposed' check (status in (
    'proposed', 'approved', 'rejected', 'in_progress', 'pr_open', 'needs_manual', 'done', 'failed'
  )),
  first_seen_on date not null,
  last_seen_on date not null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  pr_url text,
  agent_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one OPEN row per ref. Closed rows (rejected/done/failed/needs_manual)
-- stay as history; if the same issue comes back after being closed, a fresh
-- proposed row is created for the owner to decide on again.
create unique index if not exists ux_ops_health_findings_open_ref
  on public.ops_health_findings (ref)
  where status in ('proposed', 'approved', 'in_progress', 'pr_open');

create index if not exists idx_ops_health_findings_report on public.ops_health_findings (report_id);
create index if not exists idx_ops_health_findings_status on public.ops_health_findings (status);

alter table public.ops_health_reports enable row level security;
alter table public.ops_health_findings enable row level security;
revoke all on public.ops_health_reports from anon, authenticated;
revoke all on public.ops_health_findings from anon, authenticated;

comment on table public.ops_health_reports is
  'Daily storefront/ERP health & speed report, posted by the "Daily health report" cloud routine via /api/ops/health/reports. See docs/bible/modules/system-health.md.';
comment on table public.ops_health_findings is
  'Findings from ops_health_reports. Owner approves/rejects on System Health; the "Apply approved health fixes" routine turns approved code findings into GitHub PRs.';

-- Everything only the database can see, in one call. Read-only, no business
-- data: pg_stat_statements text is already normalised to $n placeholders, and
-- nothing here selects from a business table's rows (only sizes/stats).
create or replace function public.ops_health_snapshot()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog'
as $function$
declare
  v_server jsonb;
  v_server_24h jsonb;
  v_disk_7d jsonb;
  v_boots jsonb;
  v_web jsonb;
  v_cron_failures jsonb;
  v_cron_slowest jsonb;
  v_db jsonb;
  v_conn jsonb;
  v_stmt_total jsonb;
  v_stmt_mean jsonb;
  v_vacuum jsonb;
  v_tables jsonb;
  v_has_pss boolean;
begin
  select to_jsonb(m) - 'id' into v_server
  from server_metrics m order by recorded_at desc limit 1;

  select jsonb_build_object(
    'samples', count(*),
    'load_1_p95', percentile_cont(0.95) within group (order by load_1),
    'load_1_max', max(load_1),
    'cpu_temp_max', max(cpu_temp_c),
    'cpu_temp_avg', round(avg(cpu_temp_c)::numeric, 1),
    'mem_used_pct_max', round(max(mem_used_bytes::numeric / nullif(mem_total_bytes, 0) * 100), 1),
    'tunnel_down_samples', count(*) filter (where tunnel_ok = false),
    'wifi_fallback_samples', count(*) filter (where active_interface is not null and active_interface <> 'enp2s0'),
    'unhealthy_container_samples', count(*) filter (where coalesce(array_length(containers_unhealthy, 1), 0) > 0),
    -- Expected ~1440 a day; a big shortfall means the box or its collector was down.
    'expected_samples', 1440
  ) into v_server_24h
  from server_metrics where recorded_at > now() - interval '24 hours';

  select jsonb_build_object(
    'disk_used_bytes_7d_ago', (select disk_used_bytes from server_metrics
                                where recorded_at < now() - interval '7 days'
                                order by recorded_at desc limit 1),
    'disk_used_bytes_now', (select disk_used_bytes from server_metrics order by recorded_at desc limit 1),
    'disk_total_bytes', (select disk_total_bytes from server_metrics order by recorded_at desc limit 1)
  ) into v_disk_7d;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.booted_at desc), '[]'::jsonb) into v_boots
  from (select booted_at, shutdown_kind, downtime_seconds, detail
        from server_boot_events where booted_at > now() - interval '24 hours') b;

  v_web := report_website_health(now() - interval '24 hours', now());

  select coalesce(jsonb_agg(x order by x->>'start_time' desc), '[]'::jsonb) into v_cron_failures
  from (
    select jsonb_build_object('job', j.jobname, 'start_time', d.start_time, 'status', d.status,
                              'message', left(d.return_message, 300)) as x
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.start_time > now() - interval '24 hours' and d.status <> 'succeeded'
    order by d.start_time desc limit 20
  ) f;

  select coalesce(jsonb_agg(x order by (x->>'max_ms')::numeric desc), '[]'::jsonb) into v_cron_slowest
  from (
    select jsonb_build_object('job', j.jobname, 'runs', count(*),
             'max_ms', round(max(extract(epoch from (d.end_time - d.start_time)) * 1000)::numeric, 1),
             'avg_ms', round(avg(extract(epoch from (d.end_time - d.start_time)) * 1000)::numeric, 1)) as x
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.start_time > now() - interval '24 hours' and d.end_time is not null
    group by j.jobname
  ) s;

  select jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'cache_hit_pct', round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 3),
    'blks_read', blks_read,
    'temp_files', temp_files,
    'temp_bytes', temp_bytes,
    'deadlocks', deadlocks,
    'xact_commit', xact_commit,
    'xact_rollback', xact_rollback,
    'stats_reset', stats_reset,
    'work_mem', current_setting('work_mem')
  ) into v_db
  from pg_stat_database where datname = current_database();

  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where state = 'active'),
    'idle_in_transaction', count(*) filter (where state = 'idle in transaction'),
    'longest_active_seconds', round(coalesce(max(extract(epoch from (now() - query_start))) filter (where state = 'active'), 0)::numeric, 1),
    'max_connections', current_setting('max_connections')::int
  ) into v_conn
  from pg_stat_activity where datname = current_database();

  select exists (select 1 from pg_extension where extname = 'pg_stat_statements') into v_has_pss;
  if v_has_pss then
    execute $q$
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('calls', calls,
                 'total_ms', round(total_exec_time::numeric, 1),
                 'mean_ms', round(mean_exec_time::numeric, 2),
                 'rows', rows,
                 'temp_blks_written', temp_blks_written,
                 'query', left(regexp_replace(query, '\s+', ' ', 'g'), 400)) as x
        from pg_stat_statements
        where dbid = (select oid from pg_database where datname = current_database())
        order by total_exec_time desc limit 15
      ) t
    $q$ into v_stmt_total;
    execute $q$
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('calls', calls,
                 'mean_ms', round(mean_exec_time::numeric, 2),
                 'max_ms', round(max_exec_time::numeric, 1),
                 'temp_blks_written', temp_blks_written,
                 'query', left(regexp_replace(query, '\s+', ' ', 'g'), 400)) as x
        from pg_stat_statements
        where dbid = (select oid from pg_database where datname = current_database())
          and calls >= 5
        order by mean_exec_time desc limit 15
      ) t
    $q$ into v_stmt_mean;
  end if;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_vacuum
  from (
    select jsonb_build_object('table', schemaname || '.' || relname,
             'live', n_live_tup, 'dead', n_dead_tup,
             'last_autovacuum', last_autovacuum, 'last_autoanalyze', last_autoanalyze,
             'seq_scan', seq_scan, 'idx_scan', idx_scan) as x
    from pg_stat_user_tables
    where n_dead_tup > 0
    order by n_dead_tup desc limit 10
  ) v;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_tables
  from (
    select jsonb_build_object('table', n.nspname || '.' || c.relname,
             'total_bytes', pg_total_relation_size(c.oid),
             'row_estimate', c.reltuples::bigint) as x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname in ('public', 'auth', 'storage', 'cron')
    order by pg_total_relation_size(c.oid) desc limit 10
  ) t;

  return jsonb_build_object(
    'generated_at', now(),
    'server_latest', v_server,
    'server_24h', v_server_24h,
    'disk_trend', v_disk_7d,
    'boots_24h', v_boots,
    'website_health_24h', v_web,
    'cron_failures_24h', v_cron_failures,
    'cron_runtime_24h', v_cron_slowest,
    'database', v_db,
    'connections', v_conn,
    'pg_stat_statements_available', v_has_pss,
    'top_queries_by_total_time', coalesce(v_stmt_total, '[]'::jsonb),
    'top_queries_by_mean_time', coalesce(v_stmt_mean, '[]'::jsonb),
    'tables_most_dead_tuples', v_vacuum,
    'largest_tables', v_tables
  );
end;
$function$;

revoke all on function public.ops_health_snapshot() from public, anon, authenticated;
grant execute on function public.ops_health_snapshot() to service_role;

-- Safety net for the routine itself: if no report has arrived by 19:15 IST,
-- tell each owner in-app. A broken routine (expired token, quota, repo access)
-- would otherwise fail silently -- the whole point of a daily report is that
-- its absence is noticed. In-app only, matching every other cron notification.
create or replace function public.check_health_report_missing()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_count integer := 0;
begin
  if exists (select 1 from ops_health_reports where report_date = v_today) then
    return 0;
  end if;

  insert into notifications (recipient_id, type, actor_id, title, body, link)
  select p.id, 'health_report', null,
         'Today''s health report did not arrive',
         'The daily health & speed check did not post a report by 7:15pm. Check the "Daily health report" routine at claude.ai/code/routines.',
         '/dashboard/monitoring'
  from profiles p
  where p.role = 'owner' and p.is_active
    -- One nudge per day, even if this is ever run twice.
    and not exists (
      select 1 from notifications n
      where n.recipient_id = p.id and n.type = 'health_report'
        and n.title = 'Today''s health report did not arrive'
        and (n.created_at at time zone 'Asia/Kolkata')::date = v_today
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.check_health_report_missing() from public, anon, authenticated;

-- 13:45 UTC = 19:15 IST. Clear of every other job's minute.
select cron.unschedule('ops-health-report-check')
where exists (select 1 from cron.job where jobname = 'ops-health-report-check');
select cron.schedule('ops-health-report-check', '45 13 * * *', 'select public.check_health_report_missing()');

commit;
