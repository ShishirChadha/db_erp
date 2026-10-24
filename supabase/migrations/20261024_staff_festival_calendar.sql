-- Staff reference holiday calendar (Home tab) -- extends festival_calendar
-- rather than a new table, same reasoning as is_business_holiday
-- (20261005_attendance_calendar_cron.sql): this would otherwise be the same
-- three columns (name, year-specific date, deleted flag) a second time.
--
-- Approved list (owner, 2026-10-24): Holi, Republic Day, Independence Day,
-- Diwali, Dussehra, Gandhi Jayanti. Deliberately informational only -- does
-- NOT set is_business_holiday, so it has no effect on attendance/shop
-- closure, which the owner keeps managing separately in Settings >
-- Attendance & Staff. No "falls on Sunday -> compensatory next-day off"
-- logic exists anywhere here (owner explicitly ruled it out, 2026-10-24) --
-- this calendar only ever shows the holiday's real date, never shifts one.
begin;

alter table public.festival_calendar
  add column if not exists is_staff_calendar boolean not null default false;

comment on column public.festival_calendar.is_staff_calendar is
  'Shown on the Home tab''s staff holiday reference list. Independent of '
  'is_business_holiday (shop closure) -- a festival can be staff-visible '
  'without closing the shop, or vice versa. Managed from Marketing > '
  'Festival Calendar (the "Staff calendar" checkbox).';

create index if not exists festival_calendar_staff_calendar_idx
  on public.festival_calendar (festival_date)
  where is_staff_calendar and not is_deleted;

-- Flip the flag on the 2026/2027 rows already seeded for these 6 names
-- (confirmed via web lookup against calendarific/NITTTR/drikpanchang,
-- matched the DB's existing lunar-festival dates exactly).
update public.festival_calendar
set is_staff_calendar = true
where not is_deleted
  and name in ('Holi', 'Republic Day', 'Independence Day', 'Diwali', 'Dussehra', 'Gandhi Jayanti')
  and festival_date between '2026-01-01' and '2027-12-31';

-- Dussehra 2027 was the one gap in the existing seed data.
insert into public.festival_calendar (name, festival_date, is_major, is_business_holiday, is_staff_calendar)
select 'Dussehra', '2027-10-28', true, false, true
where not exists (
  select 1 from public.festival_calendar
  where name = 'Dussehra' and festival_date = '2027-10-28' and not is_deleted
);

commit;

-- ---------------------------------------------------------------------------
-- Yearly rollover, run monthly.
--
-- Fixed-date holidays (same Gregorian day every year) are inserted
-- automatically, 2 calendar years ahead -- genuinely "set and forget".
--
-- Lunar-calendar holidays (Holi/Dussehra/Diwali) shift every year and cannot
-- be computed here -- there is no formula, only an almanac lookup. Instead
-- of pretending to automate that, this raises an owner activity task once
-- the furthest-seeded lunar date gets within ~14 months of running out, so
-- there's always a heads-up with lead time rather than a silent gap the
-- Home tab just stops showing.
-- ---------------------------------------------------------------------------
create or replace function public.scan_staff_festival_calendar()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_year      int;
  v_fixed     record;
  v_furthest  date;
  v_owner     uuid;
  v_act_id    uuid;
  v_recent    int;
begin
  -- 1. Fixed-date holidays: ensure this year, next year, and the year after
  --    all have a row. Checked by exact (name, date) match, so re-running
  --    this every month is a no-op once they exist.
  for v_fixed in
    select * from (values
      ('Republic Day', 1, 26),
      ('Independence Day', 8, 15),
      ('Gandhi Jayanti', 10, 2)
    ) as t(name, mon, day)
  loop
    for v_year in extract(year from current_date)::int .. extract(year from current_date)::int + 2
    loop
      insert into festival_calendar (name, festival_date, is_major, is_business_holiday, is_staff_calendar)
      select v_fixed.name, make_date(v_year, v_fixed.mon, v_fixed.day), true, false, true
      where not exists (
        select 1 from festival_calendar
        where name = v_fixed.name
          and festival_date = make_date(v_year, v_fixed.mon, v_fixed.day)
          and not is_deleted
      );
    end loop;
  end loop;

  -- 2. Lunar holidays: nudge the owner well before the seeded list runs dry.
  select max(festival_date) into v_furthest
  from festival_calendar
  where is_staff_calendar and not is_deleted
    and name in ('Holi', 'Dussehra', 'Diwali');

  if v_furthest is not null and v_furthest < current_date + interval '14 months' then
    select count(*) into v_recent
    from activities
    where title = 'Add next year''s Holi/Dussehra/Diwali dates'
      and created_at > now() - interval '300 days';

    if v_recent = 0 then
      select id into v_owner from profiles where role = 'owner' and is_active limit 1;

      if v_owner is not null then
        insert into activities (user_id, title, description, due_date, created_by, priority, status)
        values (
          v_owner,
          'Add next year''s Holi/Dussehra/Diwali dates',
          'The staff holiday calendar (Home tab) only has lunar-festival dates up to '
            || to_char(v_furthest, 'DD Mon YYYY') || '. These shift every year and can''t be '
            || 'calculated automatically -- look up next year''s dates (e.g. drikpanchang.com '
            || 'or calendarific.com) and add them from Marketing > Festival Calendar, ticking '
            || '"Staff calendar" on each. Fixed-date holidays (Republic Day, Independence Day, '
            || 'Gandhi Jayanti) already renew themselves and need no action.',
          current_date + 14,
          v_owner, 'normal', 'pending'
        )
        returning id into v_act_id;

        insert into activity_assignees (activity_id, user_id, assigned_by)
        values (v_act_id, v_owner, v_owner);

        insert into notifications (recipient_id, type, actor_id, activity_id, title, body, link)
        values (
          v_owner, 'task_assigned', null, v_act_id,
          'Add next year''s Holi/Dussehra/Diwali dates',
          'Staff holiday calendar needs next year''s lunar festival dates.',
          '/dashboard/activities?open=' || v_act_id
        );
      end if;
    end if;
  end if;
end;
$$;

revoke all on function public.scan_staff_festival_calendar() from public, anon, authenticated;
grant all on function public.scan_staff_festival_calendar() to service_role;

select cron.schedule('scan-staff-festival-calendar', '40 21 1 * *', 'select public.scan_staff_festival_calendar();');
