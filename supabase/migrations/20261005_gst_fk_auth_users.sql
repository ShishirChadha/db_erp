-- Repoint the new tables' user FKs at auth.users.
--
-- A bare `users(id)` resolves to public.users, which exists but is EMPTY and
-- unreferenced -- every other table in this schema (sales.entered_by,
-- invoices.created_by, expenses.created_by) targets auth.users. Pointing at
-- public.users made any insert carrying a real user id fail the constraint.
begin;

alter table gst_filings drop constraint if exists gst_filings_filed_by_fkey;
alter table gst_filings drop constraint if exists gst_filings_created_by_fkey;
alter table gst_filings add constraint gst_filings_filed_by_fkey
  foreign key (filed_by) references auth.users(id);
alter table gst_filings add constraint gst_filings_created_by_fkey
  foreign key (created_by) references auth.users(id);

alter table period_locks drop constraint if exists period_locks_locked_by_fkey;
alter table period_locks drop constraint if exists period_locks_unlocked_by_fkey;
alter table period_locks add constraint period_locks_locked_by_fkey
  foreign key (locked_by) references auth.users(id);
alter table period_locks add constraint period_locks_unlocked_by_fkey
  foreign key (unlocked_by) references auth.users(id);

alter table gst_recon_imports drop constraint if exists gst_recon_imports_uploaded_by_fkey;
alter table gst_recon_imports add constraint gst_recon_imports_uploaded_by_fkey
  foreign key (uploaded_by) references auth.users(id);

alter table gst_recon_lines drop constraint if exists gst_recon_lines_resolved_by_fkey;
alter table gst_recon_lines add constraint gst_recon_lines_resolved_by_fkey
  foreign key (resolved_by) references auth.users(id);

commit;
