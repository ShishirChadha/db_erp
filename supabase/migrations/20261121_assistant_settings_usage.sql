-- DB assistant: settings, usage metering, and the one-person lock.
--
-- assistant_usage records the cost of every call DB makes -- Claude tokens per
-- step, Sarvam seconds of listening and characters of speech -- priced at the
-- time of the call, so Settings -> DB Assistant can show exactly what she has
-- used. Neither Anthropic nor Sarvam exposes the remaining balance through an
-- API, so the owner types in the credit they loaded and the page subtracts.
create table if not exists public.assistant_usage (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  profile_id uuid references public.profiles(id) on delete set null,
  thread_id uuid references public.assistant_threads(id) on delete set null,
  provider text not null check (provider in ('anthropic', 'sarvam_stt', 'sarvam_tts')),
  model text,
  input_tokens int, output_tokens int, cache_read_tokens int, cache_write_tokens int,
  audio_seconds numeric, characters int,
  cost_usd numeric(12,6) not null default 0,
  cost_inr numeric(12,4) not null default 0
);
create index if not exists idx_assistant_usage_created on public.assistant_usage (created_at desc);
alter table public.assistant_usage enable row level security;
revoke all on public.assistant_usage from anon, authenticated;
grant usage, select on sequence public.assistant_usage_id_seq to service_role;

-- DB answers to one person. master_profile_ids starts as Shishir's main login
-- (admin@digitalbluez.com); he can add another of his own logins in Settings.
insert into public.app_settings (key, value)
select 'assistant_settings', json_build_object('master_profile_ids', json_build_array(p.id))::text
from public.profiles p join auth.users u on u.id = p.id
where u.email = 'admin@digitalbluez.com'
on conflict (key) do nothing;
