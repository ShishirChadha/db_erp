-- Price Board: fast repricing with on-demand competitor benchmarks.
-- Additive only. All new tables are service-role only (RLS on, no policies).

-- 1. Owner-set pricing rules (singleton).
CREATE TABLE IF NOT EXISTS public.pricing_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  min_margin_pct numeric(5,2) NOT NULL DEFAULT 10 CHECK (min_margin_pct >= 0 AND min_margin_pct < 90),
  aging_days integer NOT NULL DEFAULT 45 CHECK (aging_days BETWEEN 7 AND 365),
  undercut_tolerance numeric(10,2) NOT NULL DEFAULT 0 CHECK (undercut_tolerance >= 0),
  beat_by numeric(10,2) NOT NULL DEFAULT 500 CHECK (beat_by >= 0),
  rounding text NOT NULL DEFAULT 'hundred' CHECK (rounding IN ('none','ten','hundred','99','999')),
  aging_drop_pct numeric(5,2) NOT NULL DEFAULT 5 CHECK (aging_drop_pct BETWEEN 0 AND 50),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.pricing_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 2. One row per price change, grouped in batches so a whole publish can be undone.
CREATE TABLE IF NOT EXISTS public.sku_price_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  sku_id uuid NOT NULL REFERENCES public.sku_master(id) ON DELETE CASCADE,
  old_price numeric(12,2),
  new_price numeric(12,2) NOT NULL CHECK (new_price > 0),
  reason text NOT NULL DEFAULT 'manual' CHECK (reason IN ('manual','bulk','suggestion','undo')),
  note text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz
);
CREATE INDEX IF NOT EXISTS sku_price_changes_batch_idx ON public.sku_price_changes (batch_id);
CREATE INDEX IF NOT EXISTS sku_price_changes_sku_idx ON public.sku_price_changes (sku_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS sku_price_changes_time_idx ON public.sku_price_changes (changed_at DESC);

-- 3. Owner-confirmed link between one of our SKUs and a competitor's listing.
CREATE TABLE IF NOT EXISTS public.competitor_price_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id uuid NOT NULL REFERENCES public.sku_master(id) ON DELETE CASCADE,
  competitor_id uuid NOT NULL REFERENCES public.seo_competitors(id) ON DELETE CASCADE,
  listing_key text NOT NULL,
  title text,
  url text,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','rejected')),
  decided_by uuid,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sku_id, competitor_id, listing_key)
);
CREATE INDEX IF NOT EXISTS competitor_price_links_sku_idx ON public.competitor_price_links (sku_id);

-- 4. Latest fetched price per competitor listing (history lives in market_price_observations).
CREATE TABLE IF NOT EXISTS public.competitor_listings (
  competitor_id uuid NOT NULL REFERENCES public.seo_competitors(id) ON DELETE CASCADE,
  listing_key text NOT NULL,
  title text NOT NULL,
  url text,
  brand text,
  model text,
  cpu text,
  generation text,
  ram_gb integer,
  ssd_gb integer,
  warranty_months integer,
  price numeric(12,2) NOT NULL,
  in_stock boolean NOT NULL DEFAULT true,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competitor_id, listing_key)
);

ALTER TABLE public.pricing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sku_price_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_price_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_listings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pricing_settings, public.sku_price_changes, public.competitor_price_links, public.competitor_listings FROM anon, authenticated;
GRANT ALL ON public.pricing_settings, public.sku_price_changes, public.competitor_price_links, public.competitor_listings TO service_role;

-- 5. Weekly old-stock review: one task + notification per active owner, skipped
-- while an earlier one is still open (same shape as scan_seo_review).
CREATE OR REPLACE FUNCTION public.scan_price_review() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  o record;
  act_id uuid;
  aging int;
  n int;
begin
  select aging_days into aging from pricing_settings where id;
  aging := coalesce(aging, 45);

  select count(*) into n from (
    select a.sku_id
    from asset_ledger a
    join sku_master s on s.id = coalesce(a.current_sku_id, a.sku_id)
    where a.status in ('ready_for_sale', 'qc_passed')
      and a.deleted_at is null
      and s.category in ('LAP', 'DES')
      and s.is_published
      and coalesce(a.received_at, a.created_at) < now() - make_interval(days => aging)
    group by a.sku_id
  ) t;
  if n = 0 then return; end if;

  for o in select id from profiles where role = 'owner' and is_active loop
    if exists (
      select 1 from activities a
      where a.user_id = o.id
        and a.title = 'Weekly price review'
        and a.status in ('pending', 'in_progress')
        and not a.is_deleted
    ) then
      continue;
    end if;

    insert into activities (user_id, title, description, due_date, created_by, priority, status)
    values (
      o.id,
      'Weekly price review',
      n || ' published laptop/desktop model(s) have units older than ' || aging || ' days. Open Price Board → Aging stock, compare with competitors (Check now) and reprice.',
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
      'Weekly price review',
      n || ' model(s) with aging stock. Open Price Board.',
      '/dashboard/activities?open=' || act_id
    );
  end loop;
end;
$$;
REVOKE EXECUTE ON FUNCTION public.scan_price_review() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_price_review() TO service_role;

-- Mondays 04:00 UTC = 09:30 IST.
SELECT cron.schedule('price-weekly-review', '0 4 * * 1', $job$select public.scan_price_review();$job$);
