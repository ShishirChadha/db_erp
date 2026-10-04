-- Phase 4: filing state and the period lock.
begin;

-- ---------------------------------------------------------------------------
-- gst_filings -- what was filed, when, and a frozen snapshot of the figures.
-- The snapshot is the point: without it, an edit after filing is undetectable,
-- and amendments (B2BA/CDNRA) have nothing to diff against.
-- ---------------------------------------------------------------------------
create table if not exists gst_filings (
  id uuid primary key default gen_random_uuid(),
  entity_key text not null references business_profiles(key),
  return_type text not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft',
  arn text,
  filed_at timestamptz,
  filed_by uuid references auth.users(id),
  -- Frozen figures as filed. Never recomputed; that is what makes later drift
  -- visible rather than silently absorbed.
  snapshot jsonb,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint gst_filings_return_type_check
    check (return_type in ('gstr1','gstr3b','gstr1a','gstr9')),
  constraint gst_filings_status_check
    check (status in ('draft','exported','filed')),
  constraint gst_filings_period_check check (period_end >= period_start),
  constraint gst_filings_unique unique (entity_key, return_type, period_start)
);

comment on table gst_filings is
  'One row per entity x return type x period. "filed" is a LOCAL state transition only -- nothing here files anything at the portal, and unfiling here does not unfile there.';
comment on column gst_filings.snapshot is
  'The figures as filed, frozen. Compared against a live recomputation to detect post-filing drift; also the basis any future amendment diffs against.';

create index if not exists gst_filings_period_idx on gst_filings (entity_key, period_start desc);

-- ---------------------------------------------------------------------------
-- period_locks -- locks by TRANSACTION date, not entry date. That distinction
-- is the whole point: it is what stops a back-dated insert landing in a period
-- already filed. Per-module rather than one global date, and a partial unlock
-- has to carry a reason, both copied from Zoho's transaction locking.
--
-- Deliberately decoupled from gst_filings: filing status is a return fact, the
-- lock is a separate owner action. A filed row can SUGGEST locking; it never
-- forces it.
-- ---------------------------------------------------------------------------
create table if not exists period_locks (
  id uuid primary key default gen_random_uuid(),
  entity_key text references business_profiles(key),
  module text not null,
  locked_through_date date not null,
  reason text,
  locked_by uuid references auth.users(id),
  locked_at timestamptz not null default now(),
  -- A partial unlock carves a window back out of the lock, and must say why.
  unlock_from date,
  unlock_to date,
  unlock_reason text,
  unlocked_by uuid references auth.users(id),
  unlocked_at timestamptz,
  constraint period_locks_module_check
    check (module in ('sales','purchases','banking','accounts')),
  constraint period_locks_unlock_window_check
    check ((unlock_from is null and unlock_to is null)
        or (unlock_from is not null and unlock_to is not null and unlock_to >= unlock_from)),
  -- An unlock window is a carve-out, so it has to state its justification.
  constraint period_locks_unlock_reason_check
    check (unlock_from is null or nullif(trim(coalesce(unlock_reason, '')), '') is not null),
  constraint period_locks_unique unique (entity_key, module)
);

comment on table period_locks is
  'Blocks writes dated on or before locked_through_date for a module. Enforced in the API layer (which is this project''s security boundary -- RLS is not). Drafts stay editable; only posted rows are blocked.';
comment on column period_locks.locked_through_date is
  'Transactions DATED on or before this are blocked, regardless of when they are entered. Locking by transaction date rather than entry date is what prevents a back-dated insert into a filed period.';

-- Is a given transaction date writable for this entity and module?
create or replace function public.is_period_locked(
  p_entity_key text, p_module text, p_txn_date date
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from period_locks l
    where l.module = p_module
      and (l.entity_key = p_entity_key or l.entity_key is null)
      and p_txn_date <= l.locked_through_date
      -- A live partial unlock covering this date re-opens it.
      and not (
        l.unlock_from is not null and l.unlocked_at is not null
        and p_txn_date between l.unlock_from and l.unlock_to
      )
  );
$function$;

comment on function public.is_period_locked(text, text, date) is
  'True when a transaction dated p_txn_date may not be written for this entity/module. A null entity_key on the lock row makes it apply to every entity.';

commit;
