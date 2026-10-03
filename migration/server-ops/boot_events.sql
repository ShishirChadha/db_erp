-- Power-outage / restart history for the ProDesk.
--
-- Why a separate table rather than deriving this from server_metrics: a reboot
-- IS visible there (uptime_seconds drops, and there is a gap in recorded_at),
-- but that can never tell you WHY the machine went down. "Someone ran reboot
-- for a kernel update" and "the mains failed and it stayed off until a human
-- pressed the button" are operationally opposite events and both look like a
-- gap. The classification can only be read from the previous boot's journal,
-- which only the box itself can do, and only right after it comes back.
--
-- One row per boot, written once at boot by erp-boot-event.service.
create table if not exists public.server_boot_events (
  id                    bigserial primary key,
  hostname              text        not null,
  -- The kernel's own boot id. Unique so a re-run of the collector (or a
  -- retry after the database was not yet up) can never double-record a boot.
  boot_id               text        not null unique,
  booted_at             timestamptz not null,
  previous_boot_id      text,
  -- Last journal entry of the previous boot. For an unclean loss this is the
  -- moment the power actually went, to within one log line.
  previous_last_seen_at timestamptz,
  -- booted_at - previous_last_seen_at. NULL on the first recorded boot.
  downtime_seconds      bigint,
  shutdown_kind         text        not null
    check (shutdown_kind in
      ('power_loss','clean_reboot','clean_shutdown','crash','unknown','first_boot')),
  detail                text,
  recorded_at           timestamptz not null default now()
);

create index if not exists server_boot_events_booted_at_idx
  on public.server_boot_events (booted_at desc);

-- Same posture as server_metrics: RLS on, no policies. Only the service-role
-- client (the owner-only /api/monitoring route) ever reads it.
alter table public.server_boot_events enable row level security;

comment on table public.server_boot_events is
  'One row per boot of the ProDesk, classifying how the previous boot ended '
  '(power loss vs planned restart) and how long the machine was down.';
