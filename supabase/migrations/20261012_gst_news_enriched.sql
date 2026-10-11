-- The news fetcher first lists items from a source's index page, then reads each linked PDF to
-- write a specific summary. enriched_at marks which items have had that second pass, so it is
-- idempotent and picks up anything it missed on the next daily run.
alter table public.gst_news_items add column if not exists enriched_at timestamptz;

-- Actioning a news item records who did it; deleting that user must not be blocked by (or
-- destroy) the item. (audit_log keeps its own NO ACTION on purpose: the audit trail is immutable,
-- so a user with history is deactivated, not deleted.)
alter table public.gst_news_items drop constraint if exists gst_news_items_updated_by_fkey;
alter table public.gst_news_items add constraint gst_news_items_updated_by_fkey
  foreign key (updated_by) references auth.users(id) on delete set null;
