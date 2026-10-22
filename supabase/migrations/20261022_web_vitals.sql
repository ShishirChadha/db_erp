begin;

-- Real-visitor speed for every page of the storefront and the ERP.
--
-- Vercel Speed Insights already measures these in visitors' browsers, but on
-- this plan its data can only be viewed in Vercel's dashboard -- exporting it
-- (which the daily health report routine would need) is a paid tier. The same
-- Core Web Vitals are available to the app itself through Next's
-- useReportWebVitals, so each app also beacons them here (components/
-- WebVitalsReporter.tsx -> POST /api/vitals) and ops_web_vitals_summary()
-- rolls them up for /api/ops/health/snapshot. Vercel's dashboard is unaffected.
--
-- Deliberately anonymous: no user id, no IP, no query string -- just which page
-- (route pattern, ids replaced), which metric, the value, and the device class.
-- 30-day retention via prune_cron_history().
create table if not exists public.web_vitals (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  app text not null check (app in ('web', 'erp')),
  route text not null,
  metric text not null check (metric in ('TTFB', 'FCP', 'LCP', 'INP', 'CLS')),
  value double precision not null,
  rating text check (rating in ('good', 'needs-improvement', 'poor')),
  navigation_type text,
  device text check (device in ('mobile', 'desktop'))
);

create index if not exists idx_web_vitals_created on public.web_vitals (created_at desc);

alter table public.web_vitals enable row level security;
revoke all on public.web_vitals from anon, authenticated;
revoke all on sequence public.web_vitals_id_seq from anon, authenticated;

comment on table public.web_vitals is
  'Anonymous real-visitor Core Web Vitals from both apps (POST /api/vitals). Summarised by ops_web_vitals_summary() for the daily health report. 30-day retention.';

-- Per app/route/metric over the window: sample count, p75 (the figure Google
-- and Vercel both judge Core Web Vitals by), share rated poor. Routes with
-- fewer than 3 samples are left out of the per-route list -- one slow load on
-- a flaky phone connection is not a finding.
create or replace function public.ops_web_vitals_summary(p_hours integer default 24)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  with w as (
    select * from web_vitals where created_at > now() - make_interval(hours => p_hours)
  ),
  overall as (
    select jsonb_agg(jsonb_build_object(
             'app', app, 'metric', metric, 'samples', n,
             'p75', round(p75::numeric, 3), 'poor_pct', poor_pct,
             'mobile_p75', round(mobile_p75::numeric, 3), 'desktop_p75', round(desktop_p75::numeric, 3))
           order by app, metric) as j
    from (
      select app, metric, count(*) n,
             percentile_cont(0.75) within group (order by value) p75,
             round(100.0 * count(*) filter (where rating = 'poor') / count(*), 1) poor_pct,
             percentile_cont(0.75) within group (order by value) filter (where device = 'mobile') mobile_p75,
             percentile_cont(0.75) within group (order by value) filter (where device = 'desktop') desktop_p75
      from w group by app, metric
    ) o
  ),
  per_route as (
    select jsonb_agg(jsonb_build_object(
             'app', app, 'route', route, 'metric', metric, 'samples', n,
             'p75', round(p75::numeric, 3), 'poor_pct', poor_pct)
           order by app, metric, p75 desc) as j
    from (
      select app, route, metric, count(*) n,
             percentile_cont(0.75) within group (order by value) p75,
             round(100.0 * count(*) filter (where rating = 'poor') / count(*), 1) poor_pct
      from w group by app, route, metric
      having count(*) >= 3
    ) r
  )
  select jsonb_build_object(
    'window_hours', p_hours,
    'total_samples', (select count(*) from w),
    'page_loads', (select count(*) from w where metric = 'TTFB'),
    'overall', coalesce((select j from overall), '[]'::jsonb),
    'per_route', coalesce((select j from per_route), '[]'::jsonb)
  );
$function$;

revoke all on function public.ops_web_vitals_summary(integer) from public, anon, authenticated;
grant execute on function public.ops_web_vitals_summary(integer) to service_role;

-- Add web_vitals to the existing nightly housekeeping instead of a new job.
create or replace function public.prune_cron_history()
returns void
language plpgsql
security definer
set search_path to 'public', 'cron', 'net'
as $function$
begin
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  delete from public.website_health_checks where checked_at < now() - interval '30 days';
  delete from net._http_response where created < now() - interval '7 days';
  delete from public.web_vitals where created_at < now() - interval '30 days';
end;
$function$;

commit;
