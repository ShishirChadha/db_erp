-- Owner-published announcements shown on the universal staff Home page
-- (app/dashboard/home) -- the one landing page every signed-in profile can
-- reach regardless of allowed_pages, which is why this needs its own table
-- rather than reusing `activities` (that model is task/assignment-shaped,
-- this is a one-to-many broadcast with no assignee and no completion state).
--
-- is_active is a soft-retire flag, not a delete -- the owner takes something
-- down without losing the ability to see what was said and when.
create table if not exists public.business_updates (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_business_updates_active_created
  on public.business_updates (is_active, created_at desc);

create or replace function public.set_business_updates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_business_updates_updated_at on public.business_updates;
create trigger trg_business_updates_updated_at
  before update on public.business_updates
  for each row execute function public.set_business_updates_updated_at();

alter table public.business_updates enable row level security;

-- Every signed-in staff member (employee/manager/owner) can read active
-- updates -- this is a broadcast, deliberately not scoped by allowed_pages,
-- since the whole point of the Home page is that it needs no page grant.
drop policy if exists business_updates_select on public.business_updates;
create policy business_updates_select on public.business_updates
  for select to authenticated
  using (( select public.is_staff() ));

-- Only the owner publishes/edits/retires an update.
drop policy if exists business_updates_owner_all on public.business_updates;
create policy business_updates_owner_all on public.business_updates
  for all to authenticated
  using (( select public.is_owner() ))
  with check (( select public.is_owner() ));
