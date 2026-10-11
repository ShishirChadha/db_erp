-- Display-only link: an accessory sold as its own cart line with a unit points at that
-- unit's sale row so the ledger/invoice views can group them. It never affects GST
-- filing (that is invoice_items.bundled_into_item_id, set deliberately in GST step 6).
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS bundled_with_sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL;

ALTER TABLE public.sales
  DROP CONSTRAINT IF EXISTS sales_bundled_with_not_self;
ALTER TABLE public.sales
  ADD CONSTRAINT sales_bundled_with_not_self CHECK (bundled_with_sale_id IS NULL OR bundled_with_sale_id <> id);

CREATE INDEX IF NOT EXISTS idx_sales_bundled_with ON public.sales (bundled_with_sale_id) WHERE bundled_with_sale_id IS NOT NULL;
