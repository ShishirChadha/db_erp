-- Attendance & Leave -- holiday calendar, nightly scan, monthly summary
-- (file 2 of 3). Apply after 20261005_attendance_core.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. Holidays -- extend festival_calendar rather than add a second table.
-- ---------------------------------------------------------------------------
-- Why extend it: an attendance_holidays table would be the same three columns
-- (name, a year-specific date, a deleted flag) and the owner would have to type
-- Diwali in twice. The ONLY information attendance needs that is not already
-- here is "are we actually shut that day" -- which is FALSE for most of this
-- calendar: it lists major AND minor/regional festivals for Marketing's content
-- planner, and the shop stays open on nearly all of them. So the flag defaults
-- to false and nothing about Marketing changes.
--
-- A non-festival closure (stock-take, shop painting) is an ordinary row with
-- is_major=false, is_business_holiday=true -- Marketing already groups its
-- display by is_major, so it stays out of that headline list.
--
-- Checked safe: /api/marketing/festivals POST and [id] PATCH both build
-- explicit column lists and cannot clobber this flag; the GET's select('*')
-- carries it along harmlessly. No marketing route change is required.
alter table public.festival_calendar
  add column if not exists is_business_holiday boolean not null default false;

comment on column public.festival_calendar.is_business_holiday is
  'Shop is closed this day -- attendance_days gets status=''holiday'' instead of '
  '''absent''. Defaults false: most rows here are marketing-content reference '
  'festivals the shop stays open on. Managed from Settings > Attendance & Staff, '
  'not from the Marketing festival calendar tab.';

create index if not exists festival_calendar_business_holiday_idx
  on public.festival_calendar (festival_date)
  where is_business_holiday and not is_deleted;

commit;

-- ---------------------------------------------------------------------------
-- 2. attendance_month_summary -- one round trip instead of N status counts.
-- ---------------------------------------------------------------------------
-- Same posture as stock_status_counts (see docs/decisions.md, 2026-09-28).
-- LEFT JOINs the roster so a staff member with no rows in the window still
-- appears, with zeroes, rather than vanishing from the monthly view.
create or replace function public.attendance_month_summary(
  p_from date,
  p_to date,
  p_staff_id uuid default null
) returns table (
  staff_id         uuid,
  full_name        text,
  employee_code    text,
  present_days     numeric,
  half_days        integer,
  absent_days      integer,
  leave_days       integer,
  holiday_days     integer,
  week_off_days    integer,
  on_duty_days     integer,
  late_days        integer,
  worked_minutes   bigint,
  overtime_minutes bigint
)
language sql stable security definer
set search_path to 'public'
as $$
  select
    s.id,
    s.full_name,
    s.employee_code,
    -- A half day counts as 0.5 of a payable-equivalent day; on_duty counts
    -- full, since the person was working, just not at the shop.
    coalesce(sum(case d.status
                   when 'present'  then 1
                   when 'on_duty'  then 1
                   when 'half_day' then 0.5
                   else 0 end), 0)::numeric,
    coalesce(count(*) filter (where d.status = 'half_day'), 0)::int,
    coalesce(count(*) filter (where d.status = 'absent'), 0)::int,
    coalesce(count(*) filter (where d.status = 'leave'), 0)::int,
    coalesce(count(*) filter (where d.status = 'holiday'), 0)::int,
    coalesce(count(*) filter (where d.status = 'week_off'), 0)::int,
    coalesce(count(*) filter (where d.status = 'on_duty'), 0)::int,
    coalesce(count(*) filter (where d.is_late), 0)::int,
    coalesce(sum(d.worked_minutes), 0)::bigint,
    coalesce(sum(d.overtime_minutes), 0)::bigint
  from staff s
  left join attendance_days d
    on d.staff_id = s.id and d.work_date between p_from and p_to
  where not s.is_deleted
    and (p_staff_id is null or s.id = p_staff_id)
  group by s.id, s.full_name, s.employee_code
  order by s.full_name;
$$;

revoke all on function public.attendance_month_summary(date, date, uuid) from public, anon, authenticated;
grant all on function public.attendance_month_summary(date, date, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. scan_attendance_days -- the nightly job. Two tasks, both idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.scan_attendance_days()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  -- CRITICAL: the IST day, not current_date. This runs at 22:15 UTC, when
  -- current_date is still the PREVIOUS UTC day while IST is already into the
  -- next one -- so `current_date - 1` would be two IST days back and would
  -- (re)materialize the wrong day every single night.
  v_yesterday  date := ((now() at time zone 'Asia/Kolkata')::date - 1);
  v_rec        record;
  v_act_id     uuid;
  v_recipient  uuid;
  v_staff_name text;
  v_fallback   uuid;
begin
  -- 1. Materialize a row for every active staff member who has none for
  --    yesterday, so the register shows a real status rather than a gap.
  --    The ON CONFLICT DO NOTHING *is* the idempotency guard here: the unique
  --    (staff_id, work_date) index makes a duplicate structurally impossible,
  --    so this half needs no separate claim marker.
  insert into attendance_days (staff_id, work_date, shift_id, status, status_source)
  select
    s.id,
    v_yesterday,
    s.default_shift_id,
    case
      when extract(isodow from v_yesterday)
             = any (coalesce(s.weekly_off_days, sh.weekly_off_days, '{7}'::smallint[]))
        then 'week_off'
      when exists (select 1 from festival_calendar f
                   where f.festival_date = v_yesterday
                     and f.is_business_holiday and not f.is_deleted)
        then 'holiday'
      else 'absent'
    end,
    case
      when extract(isodow from v_yesterday)
             = any (coalesce(s.weekly_off_days, sh.weekly_off_days, '{7}'::smallint[]))
        then 'week_off'
      when exists (select 1 from festival_calendar f
                   where f.festival_date = v_yesterday
                     and f.is_business_holiday and not f.is_deleted)
        then 'holiday'
      else 'derived'
    end
  from staff s
  left join staff_shifts sh on sh.id = s.default_shift_id
  where s.is_active
    and not s.is_deleted
    and (s.join_date is null or s.join_date <= v_yesterday)
  on conflict (staff_id, work_date) do nothing;

  -- Whoever gets the nudge when the staff member has no login of their own.
  select id into v_fallback from profiles
  where role = 'owner' and is_active limit 1;

  -- 2. Missing punch-out nudge. The UPDATE ... RETURNING is the atomic claim --
  --    the dedup marker flips in the same statement that selects the row, so
  --    two overlapping runs cannot both raise a task for the same day.
  --
  --    This function NEVER writes a punch. It will not invent a punch-out any
  --    more than scan_rental_cycles() will invent a sales row -- a human closes
  --    it from Attendance > Register. Only 'derived' days are considered, so a
  --    manually-corrected or leave day is left alone.
  for v_rec in
    update attendance_days d
       set missing_out_notified_at = now(), updated_at = now()
     where d.work_date = v_yesterday
       and d.first_in_at is not null
       and d.last_out_at is null
       and d.missing_out_notified_at is null
       and d.status_source = 'derived'
    returning d.id, d.staff_id, d.work_date, d.first_in_at
  loop
    select coalesce(s.profile_id, v_fallback), s.full_name
      into v_recipient, v_staff_name
    from staff s where s.id = v_rec.staff_id;

    continue when v_recipient is null;

    -- related_type/related_id are deliberately left NULL: this task is not
    -- about a leave request, and activities_related_pair_check forbids a type
    -- without an id. The deep link rides in notifications.link instead, rather
    -- than adding a second related_type value for one reminder.
    insert into activities (
      user_id, title, description, due_date, created_by, priority, status
    ) values (
      v_recipient,
      'Missing punch-out: ' || v_staff_name || ' (' || to_char(v_rec.work_date, 'DD Mon') || ')',
      'Punched in at ' || to_char(v_rec.first_in_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')
        || ' IST with no punch-out recorded. Correct it from Attendance > Register.',
      v_rec.work_date::timestamptz,
      v_recipient,
      'normal',
      'pending'
    )
    returning id into v_act_id;

    insert into activity_assignees (activity_id, user_id, assigned_by)
    values (v_act_id, v_recipient, v_recipient);

    insert into notifications (recipient_id, type, actor_id, activity_id, title, body, link)
    values (
      v_recipient, 'task_assigned', null, v_act_id,
      'Missing punch-out: ' || v_staff_name,
      to_char(v_rec.work_date, 'DD Mon YYYY'),
      '/dashboard/activities?open=' || v_act_id
    );
  end loop;
end;
$$;

revoke all on function public.scan_attendance_days() from public, anon, authenticated;
grant all on function public.scan_attendance_days() to service_role;
