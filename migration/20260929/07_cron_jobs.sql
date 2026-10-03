-- Captured 2026-09-29 from hosted project youfkrinsdenhoafgblj.
-- NOT present in any `supabase db dump` output (the cron schema is silently
-- omitted), so this file is the only copy of these schedules.
-- Schedules are in UTC -- the self-hosted DB must also run UTC or these shift.
-- Replay on the target AFTER the apps are confirmed healthy (Phase 7 step 7).

select cron.schedule('activity-due-date-scan',            '30 21 * * *',   $$SELECT public.scan_activity_due_dates();$$);
select cron.schedule('release-expired-web-reservations',   '7,37 * * * *',  $$select public.release_expired_reservations();$$);
select cron.schedule('erp-scheduled-backup',              '51 21 * * 6',   $$select public.run_scheduled_backup();$$);
select cron.schedule('erp-digest-dispatch',               '37 21 * * *',   $$select public.dispatch_digests();$$);
select cron.schedule('scan-recurring-expenses',           '44 21 * * *',   $$select public.scan_recurring_expenses();$$);
select cron.schedule('scan-rental-cycles',                '0 22 * * *',    $$select public.scan_rental_cycles();$$);
select cron.schedule('prune-cron-history',                '58 21 * * *',   $$select public.prune_cron_history();$$);

-- Attendance: materialize yesterday's register rows and raise a
-- missing-punch-out nudge. IST = UTC+5:30, so the IST day ends at 18:30 UTC;
-- 22:15 UTC = 03:45 IST the next morning, comfortably past IST midnight and
-- staggered after scan-rental-cycles (22:00) so the two do not contend for the
-- connection pool. The function derives "yesterday" from Asia/Kolkata and NOT
-- from current_date -- at this hour those differ by a day, which would
-- (re)materialize the wrong date every night. See its body for the full note.
select cron.schedule('scan-attendance-days', '15 22 * * *', $$select public.scan_attendance_days();$$);

-- Website uptime/latency probe for Reports > Website > Health. This job had no
-- entry in cron.job despite report_website_health consuming its table: the
-- table's newest row was 2026-09-27 and its oldest 2026-09-04, so it ran for
-- about three weeks and then stopped, leaving the Health section quietly
-- serving six-day-old data. Rescheduled 2026-10-03. Pruning is already handled
-- (prune_cron_history covers website_health_checks).
select cron.schedule('website-health-check', '*/10 * * * *', $$select public.run_website_health_check();$$);
