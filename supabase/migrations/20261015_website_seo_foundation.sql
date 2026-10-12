-- Website SEO foundation (docs/decisions.md, 2026-10-12 SEO audit, Phase 2).
-- Additive only: four owner-managed tables (service-role access, RLS on with no
-- policies, exactly like app_settings) and three column-whitelisted public views
-- the storefront reads. No existing table is altered.

-- Singleton of site-wide SEO defaults.
CREATE TABLE IF NOT EXISTS public.seo_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  default_description text,
  default_og_image_path text,
  product_description_template text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO public.seo_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Per-page metadata overrides. product -> sku_master.id, category -> category
-- code (e.g. LAP), static -> path (e.g. /privacy), blog -> post slug.
CREATE TABLE IF NOT EXISTS public.seo_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('product', 'category', 'static', 'blog')),
  entity_key text NOT NULL,
  meta_title text,
  meta_description text,
  og_image_path text,
  robots_index boolean,            -- NULL = leave the page's own default
  canonical_override text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (entity_type, entity_key)
);

-- Permanent redirects. 'auto' rows are written when a published product's slug
-- changes, so its old URL keeps its link equity instead of turning into a 404.
CREATE TABLE IF NOT EXISTS public.seo_redirects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_path text NOT NULL UNIQUE CHECK (from_path LIKE '/%'),
  to_path text NOT NULL CHECK (to_path LIKE '/%' OR to_path LIKE 'https://%'),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT seo_redirects_not_self CHECK (from_path <> to_path)
);

-- Snapshot of every settings/override/redirect change, for history + rollback
-- (field_corrections cannot revert non-scalar values, so this keeps full rows).
CREATE TABLE IF NOT EXISTS public.seo_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_key text NOT NULL,
  action text NOT NULL CHECK (action IN ('upsert', 'delete')),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS idx_seo_revisions_entity ON public.seo_revisions (entity_type, entity_key, created_at DESC);

ALTER TABLE public.seo_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_redirects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_revisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.seo_settings, public.seo_overrides, public.seo_redirects, public.seo_revisions FROM anon, authenticated;
GRANT ALL ON public.seo_settings, public.seo_overrides, public.seo_redirects, public.seo_revisions TO service_role;

-- Public views: owner-privileged, safe columns only, published rows only.
CREATE OR REPLACE VIEW public.public_seo_settings AS
  SELECT default_description, default_og_image_path, product_description_template
  FROM public.seo_settings;

CREATE OR REPLACE VIEW public.public_seo_overrides AS
  SELECT entity_type, entity_key, meta_title, meta_description, og_image_path, robots_index, canonical_override
  FROM public.seo_overrides
  WHERE status = 'published';

CREATE OR REPLACE VIEW public.public_redirects AS
  SELECT from_path, to_path FROM public.seo_redirects;

GRANT SELECT ON public.public_seo_settings, public.public_seo_overrides, public.public_redirects
  TO anon, authenticated, service_role;
