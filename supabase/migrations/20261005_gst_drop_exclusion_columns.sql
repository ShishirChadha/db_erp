-- Part 3 of the 2026-10-05 correction: drop the exclusion columns, AFTER
-- v_gst_exceptions has already been rewritten to stop referencing them
-- (20261004_gst_exceptions_view.sql must be applied first, or this fails on
-- the view's dependency -- never work around that with CASCADE).
-- Confirmed zero live rows use these columns before this migration was written.
begin;

-- ---------------------------------------------------------------------------
-- 1. Drop the exclusion columns. Confirmed zero live rows before writing this.
-- ---------------------------------------------------------------------------
alter table sales drop constraint if exists sales_gst_exclusion_reason_check;
alter table sales drop constraint if exists sales_gst_exclusion_note_check;
drop index if exists sales_gst_exclusion_idx;

alter table sales drop column if exists gst_exclusion_reason;
alter table sales drop column if exists gst_exclusion_note;
alter table sales drop column if exists gst_excluded_by;
alter table sales drop column if exists gst_excluded_at;
alter table sales drop column if exists gst_exclusion_reviewed_by;
alter table sales drop column if exists gst_exclusion_reviewed_at;

commit;
