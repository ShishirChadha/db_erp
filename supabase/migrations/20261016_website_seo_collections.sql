-- Website SEO Phase 3: curated collection pages (e.g. /laptops/dell,
-- /laptops/under-20000). Additive only. A collection is a saved listing filter
-- (same fields as the storefront's own filters) plus owner-written copy; the
-- storefront decides per request whether it is indexable (enough available
-- stock + enough original text), so nothing here can publish a thin page.

CREATE TABLE IF NOT EXISTS public.seo_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('LAP', 'DES')),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60),
  kind text NOT NULL CHECK (kind IN ('brand', 'budget', 'spec', 'use_case')),
  name text NOT NULL,
  h1 text,
  meta_title text,
  meta_description text,
  intro_md text,
  faq jsonb NOT NULL DEFAULT '[]'::jsonb,
  filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  min_products integer NOT NULL DEFAULT 3 CHECK (min_products >= 1),
  min_intro_words integer NOT NULL DEFAULT 120 CHECK (min_intro_words >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (category, slug)
);

ALTER TABLE public.seo_collections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seo_collections FROM anon, authenticated;
GRANT ALL ON public.seo_collections TO service_role;

CREATE OR REPLACE VIEW public.public_seo_collections AS
  SELECT category, slug, kind, name, h1, meta_title, meta_description, intro_md, faq, filter,
         min_products, min_intro_words, updated_at
  FROM public.seo_collections
  WHERE status = 'published';

GRANT SELECT ON public.public_seo_collections TO anon, authenticated, service_role;
