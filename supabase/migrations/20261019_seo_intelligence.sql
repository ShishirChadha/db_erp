-- Website SEO intelligence: competitor snapshots, suggestion state and the
-- weekly review reminder. Additive only; all tables service-role only (RLS on,
-- no policies, nothing granted to anon/authenticated), like the other seo_* tables.

-- Websites the owner wants analysed. One row (is_self) is our own storefront,
-- analysed the same way so ideas can be "what they do that we don't".
CREATE TABLE IF NOT EXISTS public.seo_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  base_url text NOT NULL UNIQUE CHECK (base_url ~ '^https://[^/\s]+$'),
  is_self boolean NOT NULL DEFAULT false,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_analyzed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS seo_competitors_one_self ON public.seo_competitors (is_self) WHERE is_self;

-- Extracted SIGNALS only (titles, counts, schema types, short claim snippets) --
-- never page bodies, so nothing is copied from another site.
CREATE TABLE IF NOT EXISTS public.seo_competitor_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.seo_competitors(id) ON DELETE CASCADE,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  signals jsonb,
  error text
);
CREATE INDEX IF NOT EXISTS idx_seo_snapshots_competitor ON public.seo_competitor_snapshots (competitor_id, fetched_at DESC);

-- Done / snoozed / dismissed state for suggestions (key is the suggestion's own
-- stable key, e.g. "gbp:weekly-post"). Recurring items come back when due.
CREATE TABLE IF NOT EXISTS public.seo_suggestion_state (
  key text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('done', 'snoozed', 'dismissed')),
  snoozed_until timestamptz,
  done_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.seo_competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_competitor_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_suggestion_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seo_competitors, public.seo_competitor_snapshots, public.seo_suggestion_state FROM anon, authenticated;
GRANT ALL ON public.seo_competitors, public.seo_competitor_snapshots, public.seo_suggestion_state TO service_role;

INSERT INTO public.seo_competitors (label, base_url, is_self) VALUES
  ('DigitalBluez (our site)', 'https://www.digitalbluez.com', true),
  ('EazyPC', 'https://eazypc.in', false),
  ('Edify', 'https://edify.club', false),
  ('NewJaisa', 'https://www.newjaisa.com', false),
  ('Electronics Bazaar', 'https://www.electronicsbazaar.com', false)
ON CONFLICT (base_url) DO NOTHING;

-- Weekly nudge: ONE task per active owner (skipped while an earlier one is still
-- open) pointing at Settings -> Website SEO -> Suggestions. The suggestions are
-- computed live in the app, so the text here is static. Same shape as
-- scan_recurring_expenses().
CREATE OR REPLACE FUNCTION public.scan_seo_review() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  o record;
  act_id uuid;
begin
  for o in select id from profiles where role = 'owner' and is_active loop
    if exists (
      select 1 from activities a
      where a.user_id = o.id
        and a.title = 'Weekly SEO & Google Business review'
        and a.status in ('pending', 'in_progress')
        and not a.is_deleted
    ) then
      continue;
    end if;

    insert into activities (user_id, title, description, due_date, created_by, priority, status)
    values (
      o.id,
      'Weekly SEO & Google Business review',
      'Open Settings → Website SEO → Suggestions and work through this week''s items: Google Business Profile posts and review replies, new collection pages, missing alt text, dead links and the latest competitor ideas.',
      now() + interval '3 days',
      o.id,
      'normal',
      'pending'
    )
    returning id into act_id;

    insert into activity_assignees (activity_id, user_id, assigned_by) values (act_id, o.id, o.id);

    insert into notifications (recipient_id, type, actor_id, activity_id, title, body, link)
    values (
      o.id, 'task_assigned', null, act_id,
      'Weekly SEO & Google Business review',
      'Open Website SEO → Suggestions',
      '/dashboard/activities?open=' || act_id
    );
  end loop;
end;
$$;
REVOKE EXECUTE ON FUNCTION public.scan_seo_review() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_seo_review() TO service_role;

-- Mondays 04:00 UTC = 09:30 IST.
SELECT cron.schedule('seo-weekly-review', '0 4 * * 1', $job$select public.scan_seo_review();$job$);
