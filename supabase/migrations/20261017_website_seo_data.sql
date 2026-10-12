-- Website SEO Phase 4: data loops. Additive only, owner/service-role access.
--  * seo_keywords  - the keyword -> target page map; volumes/positions are stored
--                    ONLY when imported from a named source (never estimated).
--  * seo_crawl_imports / seo_crawl_pages - a Screaming Frog "Internal: All" export.
--    Issues are derived from these rows on demand, not stored a second time.
--  * seo_404_log   - addresses visitors/crawlers asked for that returned 404.

CREATE TABLE IF NOT EXISTS public.seo_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword text NOT NULL,
  cluster text,
  intent text CHECK (intent IS NULL OR intent IN ('informational', 'commercial', 'transactional', 'navigational', 'local')),
  geo text,
  target_url text,
  priority integer CHECK (priority IS NULL OR priority BETWEEN 1 AND 3),
  volume integer CHECK (volume IS NULL OR volume >= 0),
  volume_source text,
  clicks integer,
  impressions integer,
  avg_position numeric(6, 2),
  metrics_source text,
  metrics_as_of date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT seo_keywords_volume_needs_source CHECK (volume IS NULL OR volume_source IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS seo_keywords_keyword_key ON public.seo_keywords (lower(keyword));
CREATE INDEX IF NOT EXISTS idx_seo_keywords_cluster ON public.seo_keywords (cluster);

CREATE TABLE IF NOT EXISTS public.seo_crawl_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text,
  row_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE IF NOT EXISTS public.seo_crawl_pages (
  id bigserial PRIMARY KEY,
  import_id uuid NOT NULL REFERENCES public.seo_crawl_imports(id) ON DELETE CASCADE,
  url text NOT NULL,
  status_code integer,
  indexability text,
  indexability_status text,
  title text,
  meta_description text,
  h1 text,
  word_count integer,
  inlinks integer,
  response_time numeric(8, 3),
  canonical text,
  redirect_url text
);
CREATE INDEX IF NOT EXISTS idx_seo_crawl_pages_import ON public.seo_crawl_pages (import_id);

CREATE TABLE IF NOT EXISTS public.seo_404_log (
  path text PRIMARY KEY,
  hits integer NOT NULL DEFAULT 1,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  last_referrer text
);

-- Called only by apps/web's own route with the service role. Bounded so junk
-- URLs cannot grow the table without limit: past 5,000 distinct paths only
-- already-known paths are counted.
CREATE OR REPLACE FUNCTION public.log_404(p_path text, p_referrer text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_path IS NULL OR length(p_path) = 0 OR length(p_path) > 300 OR left(p_path, 1) <> '/' THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.seo_404_log WHERE path = p_path) THEN
    UPDATE public.seo_404_log
       SET hits = hits + 1, last_seen = now(), last_referrer = COALESCE(left(p_referrer, 300), last_referrer)
     WHERE path = p_path;
  ELSIF (SELECT count(*) FROM public.seo_404_log) < 5000 THEN
    INSERT INTO public.seo_404_log (path, last_referrer) VALUES (p_path, left(p_referrer, 300))
    ON CONFLICT (path) DO UPDATE SET hits = public.seo_404_log.hits + 1, last_seen = now();
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_404(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_404(text, text) TO service_role;

ALTER TABLE public.seo_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_crawl_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_crawl_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_404_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seo_keywords, public.seo_crawl_imports, public.seo_crawl_pages, public.seo_404_log FROM anon, authenticated;
GRANT ALL ON public.seo_keywords, public.seo_crawl_imports, public.seo_crawl_pages, public.seo_404_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.seo_crawl_pages_id_seq TO service_role;
