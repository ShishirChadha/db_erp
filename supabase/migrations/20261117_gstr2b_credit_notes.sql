-- Supplier credit/debit notes (2B cdnr) net against ITC. Stored as totals on the
-- import rather than recon lines: there is no ERP document to match them to yet,
-- and step 9 only needs the net effect per head.
ALTER TABLE public.gst_recon_imports ADD COLUMN IF NOT EXISTS credit_notes jsonb;
