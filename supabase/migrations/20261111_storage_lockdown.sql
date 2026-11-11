-- Storage buckets: replace "any authenticated login" with staff/owner checks.
-- Website customers share the `authenticated` role with staff, so a bare
-- `to authenticated` policy let any self-registered customer list, read,
-- upload and delete staff files directly through the Storage API.
--
-- purchase-files: used by Activity Hub comment attachments, invoice
-- attachments and the legacy Purchases page -- staff, not owner-only.
-- purchase-invoices: no code writes to it; reads were already owner-only.

begin;

drop policy if exists "Allow select for authenticated" on storage.objects;
drop policy if exists "Allow upload for authenticated" on storage.objects;
drop policy if exists "Allow delete for authenticated" on storage.objects;
drop policy if exists "Allow insert for authenticated users" on storage.objects;
drop policy if exists "Allow upload for authenticated users" on storage.objects;

create policy purchase_files_staff_select on storage.objects
  for select to authenticated
  using (bucket_id = 'purchase-files' and (select public.is_staff()));
create policy purchase_files_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'purchase-files' and (select public.is_staff()));
create policy purchase_files_staff_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'purchase-files' and (select public.is_staff()));

create policy purchase_invoices_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'purchase-invoices' and (select public.is_owner()));

commit;
