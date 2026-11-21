-- DB's learnings: record whether a note came from a conversation (DB offered,
-- the owner said yes) or was added by hand in Settings -> DB Assistant.
alter table public.assistant_notes
  add column if not exists source text not null default 'conversation';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'assistant_notes_source_check') then
    alter table public.assistant_notes add constraint assistant_notes_source_check check (source in ('conversation', 'manual'));
  end if;
end $$;
