-- Lead Sets: master/working-copy split, merge-back tracking.
--
-- Up to now, "assigning" a Set meant handing over the only copy of its rows
-- (reassign mutates current_assignee_id on the same lead_sets/leads rows in
-- place). The owner wants the opposite for the common case: the original/raw
-- data stays owner-controlled forever, and each employee works a disposable
-- copy that can later be reviewed and folded back in, deduping against the
-- master by phone/email/name. Reassign itself is unchanged -- it still moves
-- an in-progress working copy's own rows (with history) to a new holder,
-- e.g. staff turnover -- this migration only adds the new fork+merge path
-- alongside it.
--
-- All additions are nullable/backward-compatible: every existing lead_sets/
-- leads row keeps working unchanged as a master with nothing yet to merge.

begin;

-- A Set is a master by default (every upload/from-customers/clone stays
-- exactly as today). It's a working copy only when forked via the new
-- POST /api/lead-sets/[id]/assign action, which sets this column. Kept
-- deliberately separate from cloned_from_set_id: Clone's own contract
-- ("never merges back", owner-only, fresh-campaign use case) must not
-- change, so it keeps its own column and meaning.
alter table public.lead_sets
  add column if not exists working_copy_of_set_id uuid references public.lead_sets(id);
create index if not exists lead_sets_working_copy_of_idx on public.lead_sets (working_copy_of_set_id) where is_deleted = false;

-- source_lead_id: which master lead a working-copy lead was forked from.
-- NULL means this row was added directly in the working copy (a referral)
-- and has no master counterpart yet -- this is exactly the signal
-- merge-preview uses to tell "existing lead, possibly edited" apart from
-- "brand-new lead, needs a dedupe check" (apps/erp/lib/leads.ts).
alter table public.leads
  add column if not exists source_lead_id uuid references public.leads(id);
-- source_snapshot: the five contact fields + status as they stood at fork
-- time, so merge-preview's diff only surfaces fields the employee actually
-- touched, not every field on every lead.
alter table public.leads
  add column if not exists source_snapshot jsonb;
-- merge_status: existing rows default to 'merged' (nothing to review --
-- they predate this feature); only rows created by the fork action start at
-- 'pending'. 'skipped' is a reviewed-and-declined state, distinct from never
-- having been reviewed, so a later merge pass doesn't re-surface it.
alter table public.leads
  add column if not exists merge_status text not null default 'merged';
alter table public.leads drop constraint if exists leads_merge_status_check;
alter table public.leads add constraint leads_merge_status_check
  check (merge_status in ('pending', 'merged', 'skipped'));

create index if not exists leads_source_lead_id_idx on public.leads (source_lead_id) where source_lead_id is not null;
create index if not exists leads_pending_merge_idx on public.leads (set_id) where merge_status = 'pending' and is_deleted = false;

commit;

-- No RLS policy changes needed: the existing manager-or-above / own-row
-- policies on lead_sets and leads already cover these new columns, and this
-- module's real write boundary is the API layer regardless (every route runs
-- on supabaseAdmin, which bypasses RLS -- see the header comment in
-- backups/20261006_lead_sets.sql).
