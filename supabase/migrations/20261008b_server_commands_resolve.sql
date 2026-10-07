begin;

-- Fixes a real gap found right after the first restart done through the
-- buttons: the page correctly showed "in progress" but then NEVER cleared it,
-- because nothing was ever written to resolve it. The original design's
-- reasoning ("the box has no moment left to write a completion row") was
-- right about the POLLER -- but the GET route reading this table back is a
-- different thing entirely, and it already has everything needed to tell a
-- restart actually completed: a server_boot_events row with booted_at AFTER
-- this command was acknowledged. That comparison belongs in the API route
-- (see apps/erp/app/api/monitoring/command/route.ts), not the box.
alter table public.server_commands drop constraint server_commands_status_check;
alter table public.server_commands add constraint server_commands_status_check
  check (status in ('pending', 'acknowledged', 'done', 'failed'));

alter table public.server_commands add column if not exists resolved_at timestamptz;

comment on table public.server_commands is
  'Owner-requested restart/shutdown of the self-hosted ProDesk, polled and executed by erp-command-poller.timer. GET /api/monitoring/command resolves a stuck pending/acknowledged row to done (a server_boot_events row after acknowledged_at proves it actually rebooted) or failed (timed out with no such boot). See docs/bible/modules/system-health.md.';

commit;
