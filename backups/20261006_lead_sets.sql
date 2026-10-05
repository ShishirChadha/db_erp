-- Lead Sets -- cold-contact / sales-pitch calling lists.
--
-- A "Lead Set" (lead_sets) is a named batch of contacts (e.g. "Golden Data",
-- "Noida Data") assigned as a whole to one staff member to work. Deliberately
-- NOT modeled as customers rows: a lead is pre-sale/unconfirmed, and the
-- assignment/recycling model (hand a Set to someone, later reassign it with
-- or without history) has no analog in how customers work. Deliberately NOT
-- routed through lib/auth/redact.ts either: that system hides specific
-- COLUMNS by role; what's needed here is partitioning ROWS by who a Set is
-- currently assigned to -- a different axis.
--
-- Access model mirrors backups/20261005_attendance_core.sql exactly (own-row-
-- or-manager RLS, reusing public.is_manager_or_above(), no insert/update
-- policy for a plain employee -- all writes go through API routes on the
-- service role, which enforce dedupe checks, "only the current holder may
-- edit," and clone/transfer authorization).
--
-- Call-history/notes live in the existing `activities` table (related_type
-- 'lead'), lazily created on a lead's first logged note rather than one row
-- per lead at import time -- see leads.activity_id below.

begin;

-- ---------------------------------------------------------------------------
-- 1. lead_sets
-- ---------------------------------------------------------------------------
create table if not exists public.lead_sets (
  id                  uuid        primary key default gen_random_uuid(),
  name                text        not null,
  description         text,
  source_type         text        not null,
  status              text        not null default 'active',
  current_assignee_id uuid        references public.profiles(id),
  -- Lineage when this Set is a fresh-copy clone of another -- NOT reused for
  -- "how the data originally entered the system" (source_type), since a
  -- clone's leads might themselves trace back to an upload/scrape/snapshot
  -- that's still worth knowing.
  cloned_from_set_id  uuid        references public.lead_sets(id),
  created_by          uuid        not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  is_deleted          boolean     not null default false,
  constraint lead_sets_source_type_check check (source_type in ('upload','manual','scrape','customers_snapshot')),
  constraint lead_sets_status_check check (status in ('active','archived'))
);
create index if not exists lead_sets_current_assignee_idx on public.lead_sets (current_assignee_id) where is_deleted = false;

-- ---------------------------------------------------------------------------
-- 2. leads
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id                    uuid        primary key default gen_random_uuid(),
  set_id                uuid        not null references public.lead_sets(id),
  name                  text        not null,
  phone                 text,
  email                 text,
  address               text,
  external_identifier   text,
  -- Validated against custom_options category 'lead_status' at the API layer,
  -- not a DB CHECK -- matches every other custom_options-backed field in
  -- this app (e.g. sales.sold_by against staff_names).
  status                text        not null default 'new',
  converted_customer_id uuid        references public.customers(id),
  converted_at          timestamptz,
  -- Null until the first note/call is logged (see migration header). This is
  -- also what makes a fresh-copy clone's "zero history" true for free: a
  -- cloned lead starts with activity_id null, the same as any never-worked lead.
  activity_id           uuid        references public.activities(id),
  created_by            uuid        not null references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  is_deleted            boolean     not null default false
);
create unique index if not exists leads_activity_id_unique on public.leads (activity_id) where activity_id is not null;
create index if not exists leads_set_id_idx on public.leads (set_id) where is_deleted = false;
-- Non-unique: the same real person can legitimately appear in more than one
-- Set (e.g. both "Golden Data" and "Google Data"). This index backs an
-- import-time duplicate WARNING only -- never a hard block like
-- customers_active_phone_unique, which is correct only because a customer is
-- one real-world entity and a lead is "this phone as scraped into this list".
create index if not exists leads_phone_lookup_idx on public.leads (btrim(phone)) where is_deleted = false and phone is not null and btrim(phone) <> '';

-- ---------------------------------------------------------------------------
-- 3. lead_set_assignment_history
-- ---------------------------------------------------------------------------
-- Audit trail of who held a Set and when -- current_assignee_id alone is
-- destructively overwritten on every reassignment, and "who had Golden Data
-- before Priya, and for how long" is exactly what matters if someone leaves.
create table if not exists public.lead_set_assignment_history (
  id            uuid        primary key default gen_random_uuid(),
  set_id        uuid        not null references public.lead_sets(id),
  assignee_id   uuid        not null references public.profiles(id),
  assigned_by   uuid        not null references public.profiles(id),
  assigned_at   timestamptz not null default now(),
  unassigned_at timestamptz,
  note          text
);
create index if not exists lead_set_assignment_history_set_idx on public.lead_set_assignment_history (set_id, assigned_at desc);

commit;

-- ===========================================================================
-- custom_options seed: lead_status pick-list
-- ===========================================================================
begin;
insert into public.custom_options (category, value, sort_order)
values
  ('lead_status', 'New', 0),
  ('lead_status', 'Contacted', 1),
  ('lead_status', 'Follow-up Scheduled', 2),
  ('lead_status', 'Interested', 3),
  ('lead_status', 'Converted', 4),
  ('lead_status', 'Not Interested', 5),
  ('lead_status', 'Dead', 6)
on conflict do nothing;
commit;

-- ===========================================================================
-- RLS
-- ===========================================================================
--
-- Honest framing, same as attendance_core.sql: every app read/write goes
-- through supabaseAdmin (service role), which BYPASSES RLS -- the API routes
-- are the real boundary. These policies are defense-in-depth against a direct
-- PostgREST call made with a user's own JWT.

begin;

alter table public.lead_sets                  enable row level security;
alter table public.leads                       enable row level security;
alter table public.lead_set_assignment_history enable row level security;

-- public.is_manager_or_above() already exists (backups/20261005_attendance_core.sql) -- reused, not redefined.

drop policy if exists lead_sets_read_own_or_manager on public.lead_sets;
create policy lead_sets_read_own_or_manager on public.lead_sets
  for select to authenticated
  using (( select public.is_manager_or_above() ) or current_assignee_id = ( select auth.uid() ));
drop policy if exists lead_sets_manager_write on public.lead_sets;
create policy lead_sets_manager_write on public.lead_sets
  for all to authenticated
  using (( select public.is_manager_or_above() ))
  with check (( select public.is_manager_or_above() ));

drop policy if exists leads_read_own_or_manager on public.leads;
create policy leads_read_own_or_manager on public.leads
  for select to authenticated
  using (
    ( select public.is_manager_or_above() )
    or exists (select 1 from public.lead_sets ls
               where ls.id = leads.set_id and ls.current_assignee_id = ( select auth.uid() ))
  );
-- Deliberately NO insert/update/delete policy for a plain employee: self-serve
-- upload, note-logging, and status edits all go through the API routes on the
-- service role, which enforce "only the current holder may write" -- granting
-- a direct authenticated write here would let an employee bypass that, the
-- cross-Set duplicate-phone check, and the conversion/dedupe logic.
drop policy if exists leads_manager_write on public.leads;
create policy leads_manager_write on public.leads
  for all to authenticated
  using (( select public.is_manager_or_above() ))
  with check (( select public.is_manager_or_above() ));

drop policy if exists lead_history_read_own_or_manager on public.lead_set_assignment_history;
create policy lead_history_read_own_or_manager on public.lead_set_assignment_history
  for select to authenticated
  using (( select public.is_manager_or_above() ) or assignee_id = ( select auth.uid() ));
drop policy if exists lead_history_manager_write on public.lead_set_assignment_history;
create policy lead_history_manager_write on public.lead_set_assignment_history
  for all to authenticated
  using (( select public.is_manager_or_above() ))
  with check (( select public.is_manager_or_above() ));

commit;

-- ===========================================================================
-- CONSTRAINT WIDENING (page keys, activities related_type)
-- ===========================================================================
begin;

-- New page key: 'leads'. Must stay in step with ALLOWED_PAGE_KEYS /
-- EDITABLE_PAGE_KEYS in apps/erp/app/api/users/route.ts,
-- apps/erp/app/api/users/[id]/route.ts and apps/erp/components/UserManager.tsx.
alter table public.profiles drop constraint if exists profiles_allowed_pages_check;
alter table public.profiles add constraint profiles_allowed_pages_check
  check (allowed_pages <@ array[
    'dashboard','pending_tasks','new_entry','accessories','repair_jobs','replacement_jobs',
    'sku_master','live_stock','invoices','customers','activities','sales','stock','website',
    'expenses','reports','quotations','rma','marketing','rentals','attendance','leads'
  ]::text[]);

alter table public.profile_page_actions drop constraint if exists profile_page_actions_page_key_check;
alter table public.profile_page_actions add constraint profile_page_actions_page_key_check
  check (page_key = any (array[
    'new_entry','accessories','repair_jobs','replacement_jobs','sku_master','live_stock',
    'invoices','customers','activities','sales','stock','website','expenses','quotations',
    'rma','marketing','rentals','attendance','leads'
  ]::text[]));

-- New related_type: 'lead'. Must stay in step with ACTIVITY_RELATED_TYPES in
-- apps/erp/lib/activities.ts and the RelatedType union / RELATED_TYPE_LABELS /
-- RELATED_TYPE_LINK_BASE in apps/erp/components/ActivityList.tsx.
alter table public.activities drop constraint if exists activities_related_type_check;
alter table public.activities add constraint activities_related_type_check
  check ((related_type is null) or (related_type = any (array[
    'customer','sale','purchase_order','asset','repair_job','invoice','vendor',
    'recurring_expense','marketing_asset','rental_agreement','leave_request','lead'
  ]::text[])));

commit;
