-- DB, the owner's voice secretary (apps/erp/lib/assistant/**).
--
-- assistant_threads holds each conversation, because a serverless function has
-- no memory between turns: the full Messages API history (messages) plus the
-- one write DB has proposed and is waiting for a "yes" on (pending_action).
--
-- assistant_notes are the things the owner asked DB to remember ("ABC always
-- gets a free bag and mouse"). DB proposes a note; it is saved only on a yes.
-- This is how DB "learns": visible, editable, and nothing is learned silently.
--
-- Both are read and written only by the ERP's service-role routes, so RLS is on
-- with no policies and no grants -- the same lockdown as server_commands.

create table if not exists public.assistant_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  messages jsonb not null default '[]'::jsonb,
  pending_action jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_assistant_threads_owner_updated
  on public.assistant_threads (owner_id, updated_at desc);

create table if not exists public.assistant_notes (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('customer', 'general')),
  subject_id uuid references public.customers(id) on delete cascade,
  note text not null check (length(trim(note)) > 0),
  created_by uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((subject_type = 'customer') = (subject_id is not null))
);

create index if not exists idx_assistant_notes_subject
  on public.assistant_notes (subject_type, subject_id) where is_active;

alter table public.assistant_threads enable row level security;
alter table public.assistant_notes enable row level security;
revoke all on public.assistant_threads from anon, authenticated;
revoke all on public.assistant_notes from anon, authenticated;
