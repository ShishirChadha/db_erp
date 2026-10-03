-- Attendance & Leave -- the leave request/approve flow (file 3 of 3).
-- Apply after 20261005_attendance_core.sql and 20261005_attendance_calendar_cron.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. activities.related_type learns 'leave_request'
-- ---------------------------------------------------------------------------
-- A leave request is a "someone should decide this" item, so it is an
-- activities row like every other approval in this app -- never a new
-- per-module task table, and never a per-module notifier (notifications is
-- reused as-is; notifications.type has no CHECK, and the existing
-- task_assigned / status_changed vocabulary already fits, so no new type value
-- is introduced).
--
-- Keep in step with ACTIVITY_RELATED_TYPES in apps/erp/lib/activities.ts and
-- the RelatedType union + RELATED_TYPE_LABELS + RELATED_TYPE_LINK_BASE in
-- apps/erp/components/ActivityList.tsx.
alter table public.activities drop constraint if exists activities_related_type_check;
alter table public.activities add constraint activities_related_type_check
  check (related_type is null or related_type = any (array[
    'customer','sale','purchase_order','asset','repair_job','invoice','vendor',
    'recurring_expense','marketing_asset','rental_agreement','leave_request'
  ]::text[]));

commit;

-- ---------------------------------------------------------------------------
-- 2. decide_leave_request -- approve/reject, atomically.
-- ---------------------------------------------------------------------------
-- One RPC rather than a sequence of route-side writes, because the status flip
-- and the attendance_days writes must be a single transaction: a half-applied
-- approval (decided but no days written, or days written twice) is the worst
-- failure mode this module has.
create or replace function public.decide_leave_request(
  p_leave_id uuid,
  p_decision text,
  p_actor uuid,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r         record;
  v_day     date;
  v_days    integer := 0;
  v_off     smallint[];
  v_isodow  integer;
  v_claimed uuid;
begin
  if p_decision not in ('approved','rejected') then
    raise exception 'decide_leave_request: p_decision must be approved or rejected, got %', p_decision;
  end if;

  -- THE atomic claim. Only a row still 'pending' transitions, so a double-click,
  -- a retry, or two managers racing can produce at most one decision -- and the
  -- RETURNING is how the caller knows whether this call is the one that won.
  update leave_requests l
     set status = p_decision,
         decided_by = p_actor,
         decided_at = now(),
         decision_note = p_note,
         updated_at = now()
   where l.id = p_leave_id and l.status = 'pending'
  returning l.* into r;

  if r.id is null then
    return jsonb_build_object('claimed', false);
  end if;

  if p_decision = 'approved' then
    -- A second claim, independent of the first, so even a manual re-run of this
    -- function can never write the leave days twice.
    update leave_requests set applied_at = now()
      where id = r.id and applied_at is null
    returning id into v_claimed;

    if v_claimed is not null then
      select coalesce(s.weekly_off_days, sh.weekly_off_days, '{7}'::smallint[])
        into v_off
      from staff s left join staff_shifts sh on sh.id = s.default_shift_id
      where s.id = r.staff_id;

      for v_day in
        select generate_series(r.from_date, r.to_date, interval '1 day')::date
      loop
        v_isodow := extract(isodow from v_day);

        -- A weekly off or a shop holiday is not consumed as leave -- the person
        -- was never due at work, so it must not count against them.
        continue when v_isodow = any (v_off);
        continue when exists (
          select 1 from festival_calendar f
          where f.festival_date = v_day
            and f.is_business_holiday and not f.is_deleted
        );

        insert into attendance_days (
          staff_id, work_date, status, status_source, day_part, leave_request_id
        ) values (
          r.staff_id, v_day,
          case when r.day_part = 'full' then 'leave' else 'half_day' end,
          'leave', r.day_part, r.id
        )
        on conflict (staff_id, work_date) do update set
          -- A supervisor's manual mark for that day WINS over an approved
          -- leave: they were physically there and someone recorded it.
          -- Everything else (derived / holiday / week_off) yields to the
          -- approval.
          status           = case when attendance_days.status_source = 'manual'
                                  then attendance_days.status else excluded.status end,
          status_source    = case when attendance_days.status_source = 'manual'
                                  then attendance_days.status_source else 'leave' end,
          day_part         = case when attendance_days.status_source = 'manual'
                                  then attendance_days.day_part else excluded.day_part end,
          leave_request_id = excluded.leave_request_id,
          updated_at       = now();

        v_days := v_days + 1;
      end loop;
    end if;
  end if;

  -- Close the approval task either way -- the decision has been made, so the
  -- "someone should decide this" item is done.
  update activities
     set status = 'done', completed_at = now(), completed_by = p_actor, updated_at = now()
   where id = r.activity_id and status <> 'done';

  return jsonb_build_object(
    'claimed',      true,
    'status',       p_decision,
    'days_written', v_days,
    'activity_id',  r.activity_id,
    'staff_id',     r.staff_id,
    'requested_by', r.requested_by
  );
end;
$$;

revoke all on function public.decide_leave_request(uuid, text, uuid, text) from public, anon, authenticated;
grant all on function public.decide_leave_request(uuid, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. revoke_leave_from_days -- undo an approved leave (owner-only route).
-- ---------------------------------------------------------------------------
-- Releases only the days this request actually claimed and still owns
-- (status_source = 'leave'), then recomputes each from the punch log. A day a
-- supervisor has since marked manually is left strictly alone.
create or replace function public.revoke_leave_from_days(
  p_leave_id uuid,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r      record;
  v_rec  record;
  v_days integer := 0;
begin
  update leave_requests l
     set status = 'cancelled',
         decided_by = p_actor,
         decided_at = now(),
         updated_at = now()
   where l.id = p_leave_id and l.status = 'approved'
  returning l.* into r;

  if r.id is null then
    return jsonb_build_object('claimed', false);
  end if;

  for v_rec in
    select staff_id, work_date from attendance_days
    where leave_request_id = r.id and status_source = 'leave'
  loop
    update attendance_days
       set status_source = 'derived',
           leave_request_id = null,
           day_part = 'full',
           updated_at = now()
     where staff_id = v_rec.staff_id and work_date = v_rec.work_date;

    -- Now that the day is 'derived' again, the guard inside
    -- recompute_attendance_day() lets it rewrite status from the punch log.
    perform public.recompute_attendance_day(v_rec.staff_id, v_rec.work_date);
    v_days := v_days + 1;
  end loop;

  -- Clear the claim so a later re-approval (a fresh request) is not blocked by
  -- a stale applied_at on this one.
  update leave_requests set applied_at = null where id = r.id;

  update activities
     set status = 'cancelled', updated_at = now()
   where id = r.activity_id and status <> 'cancelled';

  return jsonb_build_object('claimed', true, 'days_released', v_days, 'staff_id', r.staff_id);
end;
$$;

revoke all on function public.revoke_leave_from_days(uuid, uuid) from public, anon, authenticated;
grant all on function public.revoke_leave_from_days(uuid, uuid) to service_role;
