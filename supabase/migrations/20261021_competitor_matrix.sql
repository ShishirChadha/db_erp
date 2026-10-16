-- Price Board round 2: product-level competitor listings (all variants), per-competitor
-- price source/status, and removal of Electronics Bazaar (Cloudflare bot check on every page).
-- Additive columns only; stale competitor_listings rows are cleared so the next Check
-- repopulates them with product_key/variant data.

ALTER TABLE public.seo_competitors
  ADD COLUMN IF NOT EXISTS price_source text CHECK (price_source IN ('shopify','woocommerce','jsonld','none')),
  ADD COLUMN IF NOT EXISTS price_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_price_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_price_check_note text;

ALTER TABLE public.competitor_listings
  ADD COLUMN IF NOT EXISTS product_key text,
  ADD COLUMN IF NOT EXISTS condition text,
  ADD COLUMN IF NOT EXISTS variant_label text;
CREATE INDEX IF NOT EXISTS competitor_listings_product_idx ON public.competitor_listings (competitor_id, product_key);

-- Old rows have no product grouping; they are repopulated by the next Check.
DELETE FROM public.competitor_listings WHERE product_key IS NULL;

-- Per-model owner decisions live in competitor_price_links with listing_key = 'product:<product_key>'.
-- Electronics Bazaar blocks every automated reader, so it is removed (snapshots/links cascade).
DELETE FROM public.seo_competitors WHERE base_url IN ('https://www.electronicsbazaar.com', 'https://electronicsbazaar.com');
