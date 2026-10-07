begin;

-- Owner-initiated restart/shutdown for the self-hosted ProDesk, from the
-- System Health page. The box only ever PUSHES data out today (server_metrics
-- once a minute, server_boot_events once per boot) -- nothing listens for
-- inbound commands, which is deliberate (see system-health.md). This table is
-- the one exception, and it stays a poll, not a listener: erp-command-
-- poller.timer on the box checks for a pending row every ~10s and acts on it,
-- so there is still no new open port or exporter.
--
-- No anon/authenticated grants at all, matching server_metrics -- the ERP
-- writes through its service-role client (owner-only route), and the box
-- reads/writes through supabase_admin inside the container. RLS is enabled
-- with no policies as a second lock, even though service_role bypasses RLS by
-- default here.
create table if not exists public.server_commands (
  id uuid primary key default gen_random_uuid(),
  command text not null check (command in ('restart', 'shutdown')),
  status text not null default 'pending' check (status in ('pending', 'acknowledged', 'failed')),
  requested_by text, -- the owner's display name/email, for the audit trail shown on the page
  requested_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  error text
);

-- There is deliberately no "done" status: a restart's box is about to vanish
-- and come back on its own, and a shutdown's box just vanishes -- neither
-- leaves the poller a moment to write a completion row, and trying would just
-- race the reboot. The page's own staleness detection (server_metrics going
-- quiet, then a fresh server_boot_events row) IS the real confirmation that
-- the command actually happened, the same way it already confirms any other
-- restart.
comment on table public.server_commands is
  'Owner-requested restart/shutdown of the self-hosted ProDesk, polled and executed by erp-command-poller.timer. See docs/bible/modules/system-health.md.';

alter table public.server_commands enable row level security;

-- Keep a bounded history -- a handful of restart requests a year, never worth
-- its own pruning job, but no reason to let it grow forever either.
create index if not exists idx_server_commands_requested_at on public.server_commands (requested_at desc);

commit;
