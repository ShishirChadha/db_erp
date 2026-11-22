-- DB on several devices in one room (laptop + phone): only one may answer.
-- A single-row lease: the device that hears "Hey DB" first (or that is in a
-- conversation) holds it for a few seconds at a time and renews it while
-- talking; another device that hears the wake phrase meanwhile stays quiet.
-- Written only by /api/assistant/lease (service role); RLS on, no policies.
create table if not exists public.assistant_device_lease (
  id smallint primary key default 1 check (id = 1),
  device_id text,
  device_label text,
  until timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.assistant_device_lease enable row level security;
revoke all on public.assistant_device_lease from anon, authenticated;
insert into public.assistant_device_lease (id) values (1) on conflict (id) do nothing;
