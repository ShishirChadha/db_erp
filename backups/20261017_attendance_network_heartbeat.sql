-- Attendance -- self-updating office network (heartbeat).
--
-- WHY: the shop's ISP (Cityline) does not give a stable public IP. Between
-- 2026-10-05 and 2026-10-17 the shop egressed from 103.220.158.x, then
-- 114.142.164/165.x, then 103.60.196.x -- sometimes changing within one day.
-- A hand-maintained allowlist can never keep up, and every miss locks the whole
-- team out of punching until the owner edits Settings.
--
-- FIX: the HP ProDesk sits behind the same shop router as the staff wifi, so its
-- public egress IP is the shop's. It POSTs to /api/attendance/office-heartbeat
-- every minute; the ERP records the IP it OBSERVES on that request (never one the
-- caller claims) as a 'heartbeat' row here. Manual rows are untouched and keep
-- working exactly as before.
--
-- A heartbeat row only counts while it is fresh (12 hours). If the ProDesk dies
-- AND the ISP rotates the IP, punching blocks again -- loud, and recoverable by
-- adding a manual row -- rather than trusting an address nobody has vouched for
-- since yesterday. Old heartbeat rows are pruned by the endpoint after 30 days.

alter table public.attendance_networks
  add column if not exists source text not null default 'manual',
  add column if not exists last_seen_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'attendance_networks_source_check'
  ) then
    alter table public.attendance_networks
      add constraint attendance_networks_source_check
      check (source in ('manual', 'heartbeat'));
  end if;
end $$;

-- One heartbeat row per distinct address, so the endpoint can refresh it
-- rather than inserting a row a minute.
create unique index if not exists attendance_networks_heartbeat_cidr_uniq
  on public.attendance_networks (cidr) where source = 'heartbeat';

create or replace function public.attendance_ip_allowed(p_ip text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.attendance_networks
    where is_active
      and (source = 'manual' or last_seen_at > now() - interval '12 hours')
      and cidr >>= p_ip::inet
  );
$$;

revoke all on function public.attendance_ip_allowed(text) from public, anon, authenticated;
grant all on function public.attendance_ip_allowed(text) to service_role;
