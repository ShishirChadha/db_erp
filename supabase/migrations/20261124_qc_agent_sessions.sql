-- Auto Check: one row per "check this laptop" run.
--
-- The engineer starts a run on their own (logged-in) ERP screen and gets a short
-- code. They type `irm <erp>/q/<code> | iex` into PowerShell on the laptop being
-- checked; that script and the no-login test page it opens write their results
-- into THIS row only, authenticated by the code. Nothing here moves stock or
-- writes QC: the engineer reviews the results and saves through the existing
-- /api/stock-intake and /api/asset-ledger/[id]/qc routes with their own login.
--
-- The row is kept after the save (asset_id set) as a "hardware as received"
-- record of the unit -- battery capacity, disk wear, test results -- for later
-- warranty questions.
--
-- Service-role only, like the report views (20261123b_lock_report_functions.sql):
-- the code-gated routes are the access boundary, never RLS.

create table if not exists public.qc_agent_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'running', 'completed')),
  options jsonb not null default '{}'::jsonb,
  hardware_report jsonb,
  reported_at timestamptz,
  background_results jsonb,
  live jsonb,
  live_at timestamptz,
  interactive_results jsonb,
  asset_id uuid references public.asset_ledger(id) on delete set null,
  completed_at timestamptz
);

create index if not exists qc_agent_sessions_created_by_idx on public.qc_agent_sessions (created_by, created_at desc);
create index if not exists qc_agent_sessions_asset_idx on public.qc_agent_sessions (asset_id) where asset_id is not null;

alter table public.qc_agent_sessions enable row level security;
revoke all on public.qc_agent_sessions from anon, authenticated;
grant all on public.qc_agent_sessions to service_role;
