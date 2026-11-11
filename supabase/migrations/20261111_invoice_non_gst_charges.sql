-- Charges billed on an invoice but outside GST (e.g. shipping Zoho adds below the tax
-- total). They count in grand_total / invoice value but never in taxable value, tax,
-- or the HSN summary, so they stay off invoice_items.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS non_gst_charges numeric(12,2) NOT NULL DEFAULT 0;

DO $$
declare
  v_def text := pg_get_viewdef('public.v_gst_exceptions'::regclass, true);
  v_old text := '(COALESCE(i.subtotal, 0::numeric) + COALESCE(i.total_gst, 0::numeric))';
  v_new text := '(COALESCE(i.subtotal, 0::numeric) + COALESCE(i.total_gst, 0::numeric) + COALESCE(i.non_gst_charges, 0::numeric))';
  v_n int;
begin
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n = 0 then raise exception 'grand-total expression not found in v_gst_exceptions'; end if;
  execute 'CREATE OR REPLACE VIEW public.v_gst_exceptions AS ' || replace(v_def, v_old, v_new);
end $$;

-- DBI2026/27-00765: the 284 shipping is outside GST in Zoho (taxable 6000 + IGST 1080 + 284 = 7364).
DO $$
declare v_inv uuid := '1d88a3ab-da78-4e53-9554-1ae6d2f39a59';
begin
  delete from public.invoice_items where id = '929107dd-93a2-4b67-9504-0f558dfa4927' and invoice_id = v_inv and description = 'Shipping' and rate = 284;
  if not found then raise exception 'shipping line not found'; end if;
  update public.invoices set non_gst_charges = 284 where id = v_inv and grand_total = 7364 and subtotal = 6000 and total_gst = 1080;
  if not found then raise exception 'invoice totals changed'; end if;
  insert into public.field_corrections (table_name, record_id, field_name, old_value, new_value, reason)
  values ('invoices', v_inv, 'non_gst_charges', '0 (Shipping 284 was a 0% invoice line)', '284',
          'Shipping outside GST, as on the Zoho invoice; removed from taxable lines');
end $$;
