-- Phase 0.4 -- the things pg_dump does NOT give you.
-- `supabase db dump` omits the cron/vault/net/extensions schemas entirely, with
-- no error, so all 6 pg_cron schedules and every Vault secret vanish silently.

\echo '===== cron.job (all schedules + their command bodies) ====='
select jobid, jobname, schedule, database, username, active, command
from cron.job order by jobid;

\echo ''
\echo '===== cron.job run health (last 20 failures, if any) ====='
select jobid, status, return_message, start_time
from cron.job_run_details
where status <> 'succeeded'
order by start_time desc limit 20;

\echo ''
\echo '===== vault secrets -- CAPTURE THESE, they are unrecoverable once the project dies ====='
-- The Vault encryption key is Supabase-managed. If dispatch_digests reads its
-- x-cron-secret from here rather than inlining it, this is the only copy.
select id, name, description, decrypted_secret, created_at
from vault.decrypted_secrets order by name;

\echo ''
\echo '===== storage.buckets ====='
select id, name, public, file_size_limit, allowed_mime_types, created_at
from storage.buckets order by id;

\echo ''
\echo '===== storage object counts + bytes per bucket ====='
select bucket_id,
       count(*) as objects,
       pg_size_pretty(sum((metadata->>'size')::bigint)) as total_size
from storage.objects group by bucket_id order by bucket_id;

\echo ''
\echo '===== extensions (name + version, to match on the target) ====='
select extname, extversion from pg_extension order by extname;

\echo ''
\echo '===== timezone + version -- target MUST match the timezone ====='
select current_setting('TimeZone') as db_timezone, version() as pg_version;

\echo ''
\echo '===== sequence high-water marks -- target must be >= these ====='
-- An invoice-number sequence that resets is a GST compliance incident.
select schemaname, sequencename, last_value
from pg_sequences where schemaname = 'public' order by sequencename;

\echo ''
\echo '===== data scan: absolute supabase.co URLs stored IN the data ====='
-- Code builds URLs by concatenation, but data might hardcode them. Any hit here
-- becomes a dead image after cutover, masked for 30 days by the old project
-- still serving it.
select 'sku_master.web_description' as loc, count(*) from sku_master where web_description like '%supabase.co%'
union all select 'sku_master.web_highlights', count(*) from sku_master where web_highlights::text like '%supabase.co%'
union all select 'business_profiles', count(*) from business_profiles where to_jsonb(business_profiles)::text like '%supabase.co%'
union all select 'homepage_banners', count(*) from homepage_banners where to_jsonb(homepage_banners)::text like '%supabase.co%';
