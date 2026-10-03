-- Attendance & Leave -- core schema (file 1 of 3).
--
-- Why a new `staff` table rather than reusing something: this business has no
-- canonical employee entity. `profiles` IS a login (an auth.users row,
-- allowed_pages, device sessions) and most of this shop's staff have no login
-- and never will, so roster membership cannot be a profiles row.
-- `custom_options.staff_names` is a flat text list with no join date, no shift,
-- no active flag and no link to a login -- and it is load-bearing for
-- sales.sold_by / expenses.paid_by_staff, so its shape must not change.
--
-- `staff` is therefore ADDITIVE and attendance-only: no existing column was
-- repointed at it, and staff_names was NOT migrated. See docs/decisions.md.
--
-- The punch model is the sale_payments -> sync_sale_payment_totals ->
-- sales.amount_paid relationship, transplanted: an append-only event log
-- (attendance_punches) plus a trigger-derived one-row-per-person-per-day
-- summary (attendance_days). Raw taps are immutable audit truth; the summary is
-- what every screen reads. The derivation lives in SQL so no route can forget it.

begin;

-- ---------------------------------------------------------------------------
-- 1. staff_shifts
-- ---------------------------------------------------------------------------
-- Why a table and not custom_options: custom_options is a single `value` text
-- column -- the right home for a flat pick-list like staff_names or
-- activity_tags. A shift is a RECORD with five numeric/time attributes that
-- recompute_attendance_day() and scan_attendance_days() both join to and
-- compare against in SQL. Encoding times + thresholds into a text value would
-- mean parsing inside the database. CLAUDE.md's "add new dropdown types via
-- custom_options, not a new table" rule is about lists of values; this is not one.
create table if not exists public.staff_shifts (
  id                    uuid        primary key default gen_random_uuid(),
  name                  text        not null unique,   -- 'General', 'Morning'
  start_time            time        not null,          -- IST wall clock, no tz
  end_time              time        not null,
  -- end_time < start_time means the shift runs past midnight. Kept explicit
  -- rather than inferred so a 09:00-09:00 24h shift is not silently ambiguous.
  crosses_midnight      boolean     not null default false,
  -- Minutes after start_time before a punch-in counts as late. late_minutes is
  -- recorded from minute 1 regardless; this only gates the is_late flag.
  grace_minutes         integer     not null default 10 check (grace_minutes between 0 and 240),
  -- Worked-minute thresholds for the derived status: below half -> absent,
  -- between -> half_day, at/above full -> present.
  half_day_min_minutes  integer     not null default 240 check (half_day_min_minutes > 0),
  full_day_min_minutes  integer     not null default 450 check (full_day_min_minutes > 0),
  -- ISO day-of-week numbers (1=Mon .. 7=Sun) that are weekly offs for this shift.
  -- An array rather than a child table: it is read as a whole, never joined to
  -- or filtered by individually.
  weekly_off_days       smallint[]  not null default '{7}'::smallint[],
  is_active             boolean     not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint staff_shifts_day_thresholds_check
    check (full_day_min_minutes >= half_day_min_minutes),
  constraint staff_shifts_weekly_off_days_check
    check (weekly_off_days <@ array[1,2,3,4,5,6,7]::smallint[])
);

-- ---------------------------------------------------------------------------
-- 2. staff
-- ---------------------------------------------------------------------------
create table if not exists public.staff (
  id                 uuid        primary key default gen_random_uuid(),
  full_name          text        not null,
  -- Owner-assigned code. Unique only among non-deleted rows (partial index
  -- below) so a code can be reissued after a staff member is removed.
  employee_code      text,
  -- The login this person uses, when they have one. NULL for account-less
  -- staff, who can only ever be marked by a supervisor.
  profile_id         uuid        references public.profiles(id) on delete set null,
  join_date          date,
  default_shift_id   uuid        references public.staff_shifts(id) on delete set null,
  -- Per-person override of the shift's weekly offs. NULL = inherit the shift's.
  -- An empty array = this person has no weekly off, deliberately
  -- distinguishable from NULL, which is why this is not defaulted to '{}'.
  weekly_off_days    smallint[],
  phone              text,
  -- Which custom_options.staff_names value this person corresponds to, recorded
  -- for a FUTURE migration's benefit only. Nothing reads it, no FK, no
  -- enforcement -- it exists so a later consolidation of sales.sold_by /
  -- expenses.paid_by_staff has the mapping instead of guessing from names.
  legacy_staff_name  text,
  is_active          boolean     not null default true,
  notes              text,
  is_deleted         boolean     not null default false,
  created_by         uuid        references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint staff_weekly_off_days_check
    check (weekly_off_days is null or weekly_off_days <@ array[1,2,3,4,5,6,7]::smallint[])
);

-- Unique so two staff rows can never claim the same login, which would make
-- "my attendance" ambiguous in getMyStaffRow().
create unique index if not exists staff_profile_id_key
  on public.staff (profile_id) where profile_id is not null and not is_deleted;
create unique index if not exists staff_employee_code_key
  on public.staff (employee_code) where employee_code is not null and not is_deleted;
create index if not exists idx_staff_default_shift_id on public.staff (default_shift_id);
create index if not exists idx_staff_created_by       on public.staff (created_by);
create index if not exists idx_staff_profile_id       on public.staff (profile_id);
create index if not exists staff_join_date_idx        on public.staff (join_date desc);

-- ---------------------------------------------------------------------------
-- 3. leave_requests
-- ---------------------------------------------------------------------------
-- Created here, in file 1, even though its routes and UI land in file 3 --
-- attendance_days carries an FK to it, and creating it up front means
-- attendance_days never needs a later ALTER.
create table if not exists public.leave_requests (
  id              uuid        primary key default gen_random_uuid(),
  staff_id        uuid        not null references public.staff(id) on delete cascade,
  leave_type      text        not null
                    check (leave_type in ('casual','sick','unpaid','comp_off','other')),
  from_date       date        not null,
  to_date         date        not null,
  -- 'first_half'/'second_half' are only valid on a single-day request; a
  -- multi-day half-day leave has no sensible meaning.
  day_part        text        not null default 'full'
                    check (day_part in ('full','first_half','second_half')),
  reason          text,
  status          text        not null default 'pending'
                    check (status in ('pending','approved','rejected','cancelled')),
  -- The login that filed it. Differs from staff.profile_id when a supervisor
  -- files on behalf of an account-less staff member.
  requested_by    uuid        references public.profiles(id),
  decided_by      uuid        references public.profiles(id),
  decided_at      timestamptz,
  decision_note   text,
  -- The activities row this request was routed through for approval. The leave
  -- flow deliberately creates NO per-module task or notifier table -- it reuses
  -- activities + activity_assignees + notifications, same as every other
  -- approval/reminder in this app.
  activity_id     uuid        references public.activities(id) on delete set null,
  -- Idempotency claim for writing leave days into attendance_days. Set by a
  -- single atomic UPDATE ... RETURNING inside decide_leave_request(); a second
  -- approve call claims nothing and writes nothing.
  applied_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint leave_requests_date_order_check check (to_date >= from_date),
  constraint leave_requests_half_day_single_check
    check (day_part = 'full' or from_date = to_date),
  constraint leave_requests_decision_pair_check
    check ((decided_at is null) = (decided_by is null))
);

create index if not exists idx_leave_requests_staff_id     on public.leave_requests (staff_id);
create index if not exists idx_leave_requests_requested_by on public.leave_requests (requested_by);
create index if not exists idx_leave_requests_decided_by   on public.leave_requests (decided_by);
create index if not exists idx_leave_requests_activity_id  on public.leave_requests (activity_id);
create index if not exists leave_requests_from_date_idx    on public.leave_requests (from_date desc);
create index if not exists leave_requests_status_date_idx  on public.leave_requests (status, from_date desc);
-- Two live requests can never cover the same person+range. Partial so a
-- rejected/cancelled request does not block a resubmission.
create unique index if not exists leave_requests_live_range_idx
  on public.leave_requests (staff_id, from_date, to_date)
  where status in ('pending','approved');

-- ---------------------------------------------------------------------------
-- 4. attendance_days  (derived daily summary)
-- ---------------------------------------------------------------------------
create table if not exists public.attendance_days (
  id                      uuid        primary key default gen_random_uuid(),
  staff_id                uuid        not null references public.staff(id) on delete cascade,
  work_date               date        not null,
  shift_id                uuid        references public.staff_shifts(id) on delete set null,

  -- ---- derived from punches (trigger-owned, always refreshed) ----
  first_in_at             timestamptz,
  last_out_at             timestamptz,
  -- Sum of (out - in) over matched, non-voided pairs. NOT
  -- (last_out - first_in): a lunch punch-out/in must not be counted as worked.
  worked_minutes          integer     not null default 0 check (worked_minutes >= 0),
  punch_pair_count        integer     not null default 0,
  -- Minutes past the shift's start_time at first_in_at; 0 if on time or early.
  -- grace_minutes does not zero this out -- it only decides is_late.
  late_minutes            integer     not null default 0 check (late_minutes >= 0),
  is_late                 boolean     not null default false,
  early_exit_minutes      integer     not null default 0 check (early_exit_minutes >= 0),
  -- Minutes worked beyond the shift's span. Informational only -- there is NO
  -- payroll or money output in this build, by decision.
  overtime_minutes        integer     not null default 0 check (overtime_minutes >= 0),

  -- ---- status ----
  -- present  : met the full-day threshold (or manually marked present)
  -- half_day : worked at least half_day_min_minutes but under full
  -- absent   : no punches, or under the half-day threshold
  -- leave    : an approved leave_requests row covers this day
  -- holiday  : festival_calendar.is_business_holiday for this date
  -- week_off : this ISO weekday is in the person's weekly offs
  -- on_duty  : working away from the shop; counts as present, has no punches
  status                  text        not null default 'absent'
                            check (status in ('present','half_day','absent','leave',
                                              'holiday','week_off','on_duty')),
  -- Who decided `status`. recompute_attendance_day() only ever rewrites
  -- `status` when this is 'derived' -- that single guard is what stops a later
  -- punch, a trigger re-fire, or the nightly cron from silently undoing a
  -- supervisor's correction or an approved leave. The derived MINUTE columns
  -- above are always refreshed regardless, so a manually-marked day still
  -- shows real punch data if punches later arrive.
  status_source           text        not null default 'derived'
                            check (status_source in ('derived','manual','leave','holiday','week_off')),
  -- Half-day flavour, when a half-day leave was approved for only one half.
  day_part                text        not null default 'full'
                            check (day_part in ('full','first_half','second_half')),
  leave_request_id        uuid        references public.leave_requests(id) on delete set null,
  note                    text,
  -- Mandatory when status_source='manual' (API-enforced too, mirroring the
  -- supervisor-punch reason requirement).
  override_reason         text,
  overridden_by           uuid        references public.profiles(id),
  overridden_at           timestamptz,
  -- Dedup marker for the missing-punch-out nudge. Never means "is overdue" --
  -- that condition is always derived, same posture as
  -- rental_agreements.overdue_notified_at.
  missing_out_notified_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint attendance_days_manual_reason_check
    check (status_source <> 'manual'
           or (override_reason is not null and length(btrim(override_reason)) > 0))
);

create unique index if not exists attendance_days_staff_date_key
  on public.attendance_days (staff_id, work_date);
create index if not exists idx_attendance_days_staff_id         on public.attendance_days (staff_id);
create index if not exists idx_attendance_days_shift_id         on public.attendance_days (shift_id);
create index if not exists idx_attendance_days_leave_request_id on public.attendance_days (leave_request_id);
create index if not exists idx_attendance_days_overridden_by    on public.attendance_days (overridden_by);
create index if not exists attendance_days_work_date_idx        on public.attendance_days (work_date desc);
create index if not exists attendance_days_status_date_idx      on public.attendance_days (status, work_date desc);
-- Drives the missing-punch-out cron scan without a seq scan over history.
create index if not exists attendance_days_open_out_idx
  on public.attendance_days (work_date)
  where last_out_at is null and first_in_at is not null and missing_out_notified_at is null;

-- ---------------------------------------------------------------------------
-- 5. attendance_punches  (append-only event log)
-- ---------------------------------------------------------------------------
-- A row is NEVER updated except to void it, and never deleted. A supervisor
-- "correction" is a new row PLUS a void on the one it replaces, so the original
-- tap survives forever -- that is the audited-correction requirement. Same
-- posture as expense_reimbursements and sale_payments: the ledger is the truth,
-- attendance_days is the summary.
create table if not exists public.attendance_punches (
  id             uuid        primary key default gen_random_uuid(),
  staff_id       uuid        not null references public.staff(id) on delete cascade,
  punch_type     text        not null check (punch_type in ('in','out')),
  punched_at     timestamptz not null default now(),
  -- The IST calendar day this punch belongs to. Set by
  -- trg_attendance_punches_work_date, never by the caller. This cannot be a
  -- GENERATED column: (punched_at AT TIME ZONE 'Asia/Kolkata')::date is STABLE,
  -- not IMMUTABLE, and Postgres rejects a non-immutable generated expression.
  -- The trigger is also what lets a punch-out inherit its open punch-in's day,
  -- so a 00:30 IST punch-out closes the previous evening's shift instead of
  -- opening a phantom next-day record.
  work_date      date        not null,
  -- 'self'       = the staff member tapped it themselves (profile_id resolved)
  -- 'supervisor' = owner/manager marked or corrected it for someone
  -- 'system'     = reserved; no cron path creates punches today
  source         text        not null default 'self'
                   check (source in ('self','supervisor','system')),
  recorded_by    uuid        references public.profiles(id),
  note           text,
  -- Mandatory for source='supervisor' -- an override of someone else's
  -- attendance must say why.
  reason         text,
  -- Office-network provenance. client_ip is recorded for EVERY punch, including
  -- supervisor ones, for forensics. There is no 'blocked' ip_check value
  -- because a blocked punch is never written at all -- it is rejected with a
  -- 403 and recorded in audit_log instead.
  client_ip      inet,
  ip_check       text        check (ip_check in ('allowed','exempt_supervisor','not_enforced')),
  voided_at      timestamptz,
  voided_by      uuid        references public.profiles(id),
  void_reason    text,
  created_at     timestamptz not null default now(),
  constraint attendance_punches_supervisor_reason_check
    check (source <> 'supervisor' or (reason is not null and length(btrim(reason)) > 0)),
  constraint attendance_punches_void_pair_check
    check ((voided_at is null) = (voided_by is null))
);

create index if not exists idx_attendance_punches_staff_id    on public.attendance_punches (staff_id);
create index if not exists idx_attendance_punches_recorded_by on public.attendance_punches (recorded_by);
create index if not exists idx_attendance_punches_voided_by   on public.attendance_punches (voided_by);
create index if not exists attendance_punches_punched_at_idx  on public.attendance_punches (punched_at desc);
create index if not exists attendance_punches_staff_day_idx   on public.attendance_punches (staff_id, work_date desc);
-- The "is there an open punch-in" lookup, which every punch POST and the punch
-- widget both run -- partial so it stays tiny regardless of history size.
create index if not exists attendance_punches_open_in_idx
  on public.attendance_punches (staff_id, punched_at desc)
  where punch_type = 'in' and voided_at is null;

-- ---------------------------------------------------------------------------
-- 6. attendance_networks  (office-IP allowlist)
-- ---------------------------------------------------------------------------
-- Why a table and not an env var: an Indian broadband IP rotates, and a
-- hardcoded one locks the whole team out of punching until a code deploy. The
-- owner fixes this from Settings > Attendance & Staff in ten seconds instead.
create table if not exists public.attendance_networks (
  id          uuid        primary key default gen_random_uuid(),
  label       text        not null,            -- 'Shop wifi (Airtel)'
  -- An IPv4/IPv6 address or CIDR range. `cidr` rather than text so Postgres
  -- validates it on insert and the containment test is a native >>= operator
  -- instead of hand-rolled string/subnet parsing in JS, which is exactly where
  -- this kind of check usually breaks.
  cidr        cidr        not null,
  is_active   boolean     not null default true,
  notes       text,
  created_by  uuid        references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_attendance_networks_created_by on public.attendance_networks (created_by);
create index if not exists attendance_networks_active_idx on public.attendance_networks (cidr) where is_active;

commit;

-- ===========================================================================
-- FUNCTIONS & TRIGGERS
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- work_date stamping -- the single most important piece of timezone handling.
-- ---------------------------------------------------------------------------
-- The business is in India; the database and pg_cron both run in UTC. A punch
-- at 21:30 IST is 16:00 UTC the SAME day, but a punch at 00:30 IST is 19:00 UTC
-- the PREVIOUS day -- so a naive punched_at::date puts evening and late-night
-- punches on the wrong register. Everything downstream keys off work_date, so
-- this is computed exactly once, here, and never in application code.
create or replace function public.set_attendance_punch_work_date()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_ist_date  date := ((new.punched_at at time zone 'Asia/Kolkata')::date);
  v_open_date date;
begin
  -- A punch-out belongs to the shift it closes, not to whatever calendar day
  -- the clock happened to roll into. The 18-hour lookback is longer than any
  -- real shift but shorter than the gap to the next day's punch-in.
  if new.punch_type = 'out' then
    select p.work_date into v_open_date
    from attendance_punches p
    where p.staff_id = new.staff_id
      and p.punch_type = 'in'
      and p.voided_at is null
      and p.punched_at <= new.punched_at
      and p.punched_at > new.punched_at - interval '18 hours'
      and not exists (
        select 1 from attendance_punches o
        where o.staff_id = p.staff_id
          and o.punch_type = 'out'
          and o.voided_at is null
          and o.punched_at > p.punched_at
          and o.punched_at <= new.punched_at
      )
    order by p.punched_at desc
    limit 1;
  end if;

  new.work_date := coalesce(v_open_date, v_ist_date);
  return new;
end;
$$;

drop trigger if exists trg_attendance_punches_work_date on public.attendance_punches;
create trigger trg_attendance_punches_work_date
  before insert on public.attendance_punches
  for each row execute function public.set_attendance_punch_work_date();

-- ---------------------------------------------------------------------------
-- recompute_attendance_day -- the derivation itself.
-- ---------------------------------------------------------------------------
-- Factored out of the trigger so the leave-reversal path
-- (revoke_leave_from_days) and the nightly cron get a clean entry point
-- instead of having to poke a punch row to make the trigger re-fire.
create or replace function public.recompute_attendance_day(p_staff_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_shift       record;
  v_rec         record;
  v_open        timestamptz := null;
  v_first       timestamptz := null;
  v_last        timestamptz := null;
  v_minutes     integer := 0;
  v_pairs       integer := 0;
  v_late        integer := 0;
  v_early       integer := 0;
  v_ot          integer := 0;
  v_status      text;
  v_shift_start timestamptz;
  v_shift_end   timestamptz;
begin
  select sh.* into v_shift
  from staff s left join staff_shifts sh on sh.id = s.default_shift_id
  where s.id = p_staff_id;

  -- Walk the day's non-voided events in order, pairing each 'out' with the
  -- open 'in' before it. A duplicate 'in' while one is already open is ignored
  -- rather than treated as a new interval, and an unmatched trailing 'in'
  -- contributes first_in_at (so the day reads as started) but zero minutes --
  -- we never invent a punch-out, which is what the cron nudge exists for.
  for v_rec in
    select punch_type, punched_at
    from attendance_punches
    where staff_id = p_staff_id and work_date = p_date and voided_at is null
    order by punched_at
  loop
    if v_rec.punch_type = 'in' then
      if v_first is null then v_first := v_rec.punched_at; end if;
      if v_open is null then v_open := v_rec.punched_at; end if;
    else
      if v_open is not null then
        v_minutes := v_minutes + (extract(epoch from (v_rec.punched_at - v_open)) / 60)::int;
        v_pairs   := v_pairs + 1;
        v_last    := v_rec.punched_at;
        v_open    := null;
      end if;
    end if;
  end loop;

  if v_shift.id is not null then
    v_shift_start := (p_date + v_shift.start_time) at time zone 'Asia/Kolkata';
    v_shift_end   := (p_date + v_shift.end_time) at time zone 'Asia/Kolkata'
                     + (case when v_shift.crosses_midnight then interval '1 day' else interval '0' end);
    if v_first is not null then
      v_late := greatest(0, (extract(epoch from (v_first - v_shift_start)) / 60)::int);
    end if;
    if v_last is not null then
      v_early := greatest(0, (extract(epoch from (v_shift_end - v_last)) / 60)::int);
      v_ot    := greatest(0, (extract(epoch from (v_last - v_shift_end)) / 60)::int);
    end if;
  end if;

  v_status := case
    when v_minutes >= coalesce(v_shift.full_day_min_minutes, 450) then 'present'
    when v_minutes >= coalesce(v_shift.half_day_min_minutes, 240) then 'half_day'
    -- Punched in but not yet out: show as present on the live register rather
    -- than absent. The nightly scan re-evaluates once the day is closed.
    when v_first is not null then 'present'
    else 'absent'
  end;

  insert into attendance_days (
    staff_id, work_date, shift_id, first_in_at, last_out_at, worked_minutes,
    punch_pair_count, late_minutes, is_late, early_exit_minutes, overtime_minutes,
    status, status_source
  ) values (
    p_staff_id, p_date, v_shift.id, v_first, v_last, v_minutes,
    v_pairs, v_late, v_late > coalesce(v_shift.grace_minutes, 10), v_early, v_ot,
    v_status, 'derived'
  )
  on conflict (staff_id, work_date) do update set
    shift_id           = excluded.shift_id,
    first_in_at        = excluded.first_in_at,
    last_out_at        = excluded.last_out_at,
    worked_minutes     = excluded.worked_minutes,
    punch_pair_count   = excluded.punch_pair_count,
    late_minutes       = excluded.late_minutes,
    is_late            = excluded.is_late,
    early_exit_minutes = excluded.early_exit_minutes,
    overtime_minutes   = excluded.overtime_minutes,
    -- THE GUARD: a manual override, an approved leave, a holiday or a week-off
    -- keeps its status; only a 'derived' status is ever recomputed.
    status             = case when attendance_days.status_source = 'derived'
                              then excluded.status else attendance_days.status end,
    updated_at         = now();
end;
$$;

revoke all on function public.recompute_attendance_day(uuid, date) from public, anon, authenticated;
grant all on function public.recompute_attendance_day(uuid, date) to service_role;

create or replace function public.sync_attendance_day()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.recompute_attendance_day(
    coalesce(new.staff_id, old.staff_id),
    coalesce(new.work_date, old.work_date)
  );
  return null;
end;
$$;

drop trigger if exists trg_attendance_punches_sync_day on public.attendance_punches;
create trigger trg_attendance_punches_sync_day
  after insert or update or delete on public.attendance_punches
  for each row execute function public.sync_attendance_day();

revoke all on function public.sync_attendance_day() from public, anon, authenticated;
grant all on function public.sync_attendance_day() to service_role;

-- ---------------------------------------------------------------------------
-- updated_at triggers -- house pattern, one per table.
-- ---------------------------------------------------------------------------
create or replace function public.set_staff_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_staff_updated_at on public.staff;
create trigger trg_staff_updated_at before update on public.staff
  for each row execute function public.set_staff_updated_at();

create or replace function public.set_staff_shifts_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_staff_shifts_updated_at on public.staff_shifts;
create trigger trg_staff_shifts_updated_at before update on public.staff_shifts
  for each row execute function public.set_staff_shifts_updated_at();

create or replace function public.set_attendance_days_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_attendance_days_updated_at on public.attendance_days;
create trigger trg_attendance_days_updated_at before update on public.attendance_days
  for each row execute function public.set_attendance_days_updated_at();

create or replace function public.set_leave_requests_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_leave_requests_updated_at on public.leave_requests;
create trigger trg_leave_requests_updated_at before update on public.leave_requests
  for each row execute function public.set_leave_requests_updated_at();

create or replace function public.set_attendance_networks_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_attendance_networks_updated_at on public.attendance_networks;
create trigger trg_attendance_networks_updated_at before update on public.attendance_networks
  for each row execute function public.set_attendance_networks_updated_at();

commit;

-- ===========================================================================
-- RLS
-- ===========================================================================
--
-- Honest framing: every app read goes through supabaseAdmin (service role),
-- which BYPASSES RLS. These policies are defense-in-depth against a direct
-- PostgREST call made with a user's own JWT -- the API layer is the real
-- own-only boundary, which is why scripts/verify-attendance.mjs probes HTTP
-- endpoints rather than the database.
--
-- Deliberately NOT copying repair_jobs' legacy `auth.role() = 'authenticated'`
-- policy: storefront customers share the authenticated role since the web
-- accounts shipped, and is_staff() is what replaced that gap.

begin;

-- Owner-or-manager, for the "own-only vs see-all" rule. is_owner() is too
-- narrow (managers see the whole team) and is_staff() too broad (an employee
-- is staff). Mirrors both existing helpers exactly. NOT revoked from
-- authenticated: like is_staff()/is_owner() it is evaluated INSIDE RLS policy
-- evaluation and must stay callable by the role the policies run as.
create or replace function public.is_manager_or_above()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and role in ('owner','manager')
  );
$$;

alter table public.staff              enable row level security;
alter table public.staff_shifts       enable row level security;
alter table public.attendance_punches enable row level security;
alter table public.attendance_days    enable row level security;
alter table public.leave_requests     enable row level security;
alter table public.attendance_networks enable row level security;

-- Shifts: readable by any active staff member (the punch widget shows
-- "shift 09:30-18:30"); writable only by the owner, like every other
-- Settings-managed reference list.
drop policy if exists staff_shifts_read on public.staff_shifts;
create policy staff_shifts_read on public.staff_shifts
  for select to authenticated using (( select public.is_staff() ));
drop policy if exists staff_shifts_owner_write on public.staff_shifts;
create policy staff_shifts_owner_write on public.staff_shifts
  for all to authenticated
  using (( select public.is_owner() )) with check (( select public.is_owner() ));

-- Networks: readable by staff so the punch widget can explain WHY a punch was
-- refused; owner-only to change.
drop policy if exists attendance_networks_read on public.attendance_networks;
create policy attendance_networks_read on public.attendance_networks
  for select to authenticated using (( select public.is_staff() ));
drop policy if exists attendance_networks_owner_write on public.attendance_networks;
create policy attendance_networks_owner_write on public.attendance_networks
  for all to authenticated
  using (( select public.is_owner() )) with check (( select public.is_owner() ));

-- staff: own row (via the profile_id link) or manager-or-above. A row with
-- profile_id IS NULL can never satisfy the first clause, so account-less staff
-- are visible to supervisors only -- correct by construction, no extra branch.
-- Self-read precedent: profile_page_actions' "Staff read own page actions".
drop policy if exists staff_read_own_or_manager on public.staff;
create policy staff_read_own_or_manager on public.staff
  for select to authenticated
  using ((profile_id = ( select auth.uid() )) or ( select public.is_manager_or_above() ));
drop policy if exists staff_owner_write on public.staff;
create policy staff_owner_write on public.staff
  for all to authenticated
  using (( select public.is_owner() )) with check (( select public.is_owner() ));

-- The three attendance/leave tables share one shape: read your own rows (via
-- the staff.profile_id link) or everything if manager-or-above.
--
-- Deliberately NO insert/update policy for a plain employee on any of them.
-- Self punch-in goes through POST /api/attendance/punch on the service role,
-- which is what enforces "you may only punch yourself, only now, only once
-- while open, only from the office network". Granting an authenticated insert
-- here would let an employee forge a backdated punch, or a punch for someone
-- else, straight through PostgREST with their own JWT, bypassing all of that.
drop policy if exists attendance_punches_read_own_or_manager on public.attendance_punches;
create policy attendance_punches_read_own_or_manager on public.attendance_punches
  for select to authenticated
  using (
    ( select public.is_manager_or_above() )
    or exists (select 1 from public.staff s
               where s.id = attendance_punches.staff_id
                 and s.profile_id = ( select auth.uid() ))
  );
drop policy if exists attendance_punches_manager_write on public.attendance_punches;
create policy attendance_punches_manager_write on public.attendance_punches
  for all to authenticated
  using (( select public.is_manager_or_above() ))
  with check (( select public.is_manager_or_above() ));

drop policy if exists attendance_days_read_own_or_manager on public.attendance_days;
create policy attendance_days_read_own_or_manager on public.attendance_days
  for select to authenticated
  using (
    ( select public.is_manager_or_above() )
    or exists (select 1 from public.staff s
               where s.id = attendance_days.staff_id
                 and s.profile_id = ( select auth.uid() ))
  );
drop policy if exists attendance_days_manager_write on public.attendance_days;
create policy attendance_days_manager_write on public.attendance_days
  for all to authenticated
  using (( select public.is_manager_or_above() ))
  with check (( select public.is_manager_or_above() ));

drop policy if exists leave_requests_read_own_or_manager on public.leave_requests;
create policy leave_requests_read_own_or_manager on public.leave_requests
  for select to authenticated
  using (
    ( select public.is_manager_or_above() )
    or exists (select 1 from public.staff s
               where s.id = leave_requests.staff_id
                 and s.profile_id = ( select auth.uid() ))
  );
drop policy if exists leave_requests_manager_write on public.leave_requests;
create policy leave_requests_manager_write on public.leave_requests
  for all to authenticated
  using (( select public.is_manager_or_above() ))
  with check (( select public.is_manager_or_above() ));

commit;

-- ===========================================================================
-- CONSTRAINT WIDENING  (page keys, audit action type)
-- ===========================================================================

begin;

-- New page key: 'attendance'. View grant = profiles.allowed_pages; edit grant =
-- a profile_page_actions row. Both CHECK constraints have to learn the key, and
-- they must stay in step with ALLOWED_PAGE_KEYS / EDITABLE_PAGE_KEYS in
-- apps/erp/app/api/users/route.ts, apps/erp/app/api/users/[id]/route.ts and
-- apps/erp/components/UserManager.tsx.
alter table public.profiles drop constraint if exists profiles_allowed_pages_check;
alter table public.profiles add constraint profiles_allowed_pages_check
  check (allowed_pages <@ array[
    'dashboard','pending_tasks','new_entry','accessories','repair_jobs','replacement_jobs',
    'sku_master','live_stock','invoices','customers','activities','sales','stock','website',
    'expenses','reports','quotations','rma','marketing','rentals','attendance'
  ]::text[]);

alter table public.profile_page_actions drop constraint if exists profile_page_actions_page_key_check;
alter table public.profile_page_actions add constraint profile_page_actions_page_key_check
  check (page_key = any (array[
    'new_entry','accessories','repair_jobs','replacement_jobs','sku_master','live_stock',
    'invoices','customers','activities','sales','stock','website','expenses','quotations',
    'rma','marketing','rentals','attendance'
  ]::text[]));

-- A self-punch refused by the office-IP check writes no punch row, but the
-- attempt still has to be visible -- a pattern of them is exactly what the
-- owner would want to notice. 'blocked' is the action type for "this was
-- refused by policy", severity minor, matching login_failed's posture.
-- Keep in step with AuditActionType / SEVERITY_BY_ACTION in
-- apps/erp/lib/audit-log.ts and ACTION_LABELS in the audit-log settings page.
alter table public.audit_log drop constraint if exists audit_log_action_type_check;
alter table public.audit_log add constraint audit_log_action_type_check
  check (action_type = any (array[
    'create','update','status_change','soft_delete','restore','hard_delete',
    'void','login','login_failed','logout','blocked'
  ]::text[]));

commit;

-- ===========================================================================
-- COMMENTS
-- ===========================================================================

comment on table public.staff is
  'Canonical employee roster, including staff with no login account. Additive to '
  'custom_options.staff_names, which is deliberately unchanged -- sales.sold_by and '
  'expenses.paid_by_staff remain free text and were NOT migrated.';

comment on table public.staff_shifts is
  'Shift timings, grace, half/full-day worked-minute thresholds and weekly offs. '
  'A record, not a dropdown value -- which is why it is not in custom_options.';

comment on table public.attendance_punches is
  'Append-only punch-event log. A correction is a new row plus a void on the old '
  'one; rows are never edited or deleted. attendance_days is derived from this by '
  'recompute_attendance_day() -- the sale_payments/sync_sale_payment_totals pattern.';

comment on table public.attendance_days is
  'One derived row per staff per IST calendar day. status_source gates whether '
  'recompute_attendance_day() may rewrite status, so a manual override, approved '
  'leave, holiday or week-off is never silently undone by a later punch or the '
  'nightly scan.';

comment on table public.leave_requests is
  'Leave request -> approve flow. Approval routes through activities + '
  'activity_assignees + notifications (no per-module task table) and writes days '
  'into attendance_days via decide_leave_request(), claimed once via applied_at.';

comment on table public.attendance_networks is
  'Owner-managed office-IP allowlist for self-service punching. Enforcement is '
  'gated by the custom_options attendance_settings toggle and fails OPEN when no '
  'active row exists, so an empty list can never lock the team out. A deterrent '
  'against casual off-site punching, not a tamper-proof boundary -- see '
  'docs/bible/processes/configure-office-punch-networks.md.';

comment on column public.attendance_punches.work_date is
  'IST calendar day this punch belongs to, stamped by trigger. Cannot be a '
  'generated column: AT TIME ZONE is STABLE, not IMMUTABLE.';
