-- Upload-driven GST reconciliation.
--
-- Two sources, one shape. A Zoho invoice register and a GSTR-2B download are
-- both "a list of documents, each with a number, date, counterparty GSTIN,
-- taxable value and tax", so they share one line table rather than getting two
-- near-identical ones. What differs is the match key and which side of the
-- business they touch, and that lives in the matchers.
--
-- Follows the existing bank-recon shape (recon_sessions + bank_statements +
-- deterministic matchers in lib/recon with explicit tolerance constants)
-- rather than inventing a second reconciliation concept.

begin;

create table if not exists gst_recon_imports (
  id uuid primary key default gen_random_uuid(),
  entity_key text not null references business_profiles(key),
  kind text not null,
  period_start date not null,
  period_end date not null,
  -- Reuses the existing uploaded_documents table for the file itself.
  document_id uuid references uploaded_documents(id),
  source_filename text,
  row_count integer not null default 0,
  matched_count integer not null default 0,
  mismatch_count integer not null default 0,
  missing_in_erp_count integer not null default 0,
  missing_in_source_count integer not null default 0,
  status text not null default 'open',
  notes text,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gst_recon_imports_kind_check
    check (kind in ('zoho_invoices', 'gstr2b')),
  constraint gst_recon_imports_status_check
    check (status in ('open', 'completed')),
  constraint gst_recon_imports_period_check check (period_end >= period_start)
);

comment on table gst_recon_imports is
  'One uploaded reconciliation source: a Zoho invoice register (outward, checks nothing is missing from GSTR-1) or a GSTR-2B download (inward, checks ITC against what suppliers actually filed).';

create index if not exists gst_recon_imports_entity_idx
  on gst_recon_imports (entity_key, kind, period_start desc);

create table if not exists gst_recon_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references gst_recon_imports(id) on delete cascade,

  -- Normalised document identity, whichever side it came from.
  doc_number text,
  -- Comparison key: uppercased with every non-alphanumeric stripped, so
  -- 'DBI2026/27--00705' and 'DBI2026/27-00705' match. That exact malformed
  -- number exists in this data, which is why this is not just upper(trim()).
  doc_number_key text,
  doc_date date,
  counterparty_gstin text,
  counterparty_name text,

  taxable_value numeric(14,2),
  cgst numeric(14,2),
  sgst numeric(14,2),
  igst numeric(14,2),
  cess numeric(14,2),
  doc_value numeric(14,2),

  match_status text not null,
  -- What it matched against in the ERP, when it did.
  matched_type text,
  matched_id uuid,
  -- Field-level differences, so a mismatch explains itself rather than just
  -- being flagged.
  diff jsonb,

  -- Manual outcome. A reconciliation is only useful if last month's decisions
  -- survive into this month, so resolutions are stored, not recomputed.
  resolution text,
  resolution_note text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,

  -- The source row verbatim, for anything the normalised columns drop.
  raw jsonb,
  created_at timestamptz not null default now(),

  constraint gst_recon_lines_match_status_check
    check (match_status in ('matched', 'value_mismatch', 'missing_in_erp', 'missing_in_source')),
  constraint gst_recon_lines_matched_type_check
    check (matched_type is null or matched_type in ('invoice', 'purchase_order', 'purchase_order_item')),
  constraint gst_recon_lines_resolution_check
    check (resolution is null or resolution in ('accepted', 'entered_in_erp', 'ignored', 'chase_supplier', 'itc_claimed', 'itc_ineligible'))
);

comment on column gst_recon_lines.match_status is
  'matched = found and values agree. value_mismatch = found, figures differ. missing_in_erp = in the uploaded source but not here (for Zoho: an invoice never recorded; for 2B: ITC a supplier filed that we never booked). missing_in_source = here but not in the upload (for 2B: we claimed credit the supplier has not filed, which is what Rule 88D polices).';

create index if not exists gst_recon_lines_import_idx on gst_recon_lines (import_id, match_status);
create index if not exists gst_recon_lines_key_idx on gst_recon_lines (doc_number_key);

-- Roll the bucket counts back onto the import, so a list view never has to
-- count lines itself.
create or replace function public.sync_gst_recon_counts()
returns trigger
language plpgsql
as $function$
declare v_import uuid;
begin
  v_import := coalesce(new.import_id, old.import_id);
  update gst_recon_imports i
  set row_count = (select count(*) from gst_recon_lines l where l.import_id = v_import),
      matched_count = (select count(*) from gst_recon_lines l where l.import_id = v_import and l.match_status = 'matched'),
      mismatch_count = (select count(*) from gst_recon_lines l where l.import_id = v_import and l.match_status = 'value_mismatch'),
      missing_in_erp_count = (select count(*) from gst_recon_lines l where l.import_id = v_import and l.match_status = 'missing_in_erp'),
      missing_in_source_count = (select count(*) from gst_recon_lines l where l.import_id = v_import and l.match_status = 'missing_in_source'),
      updated_at = now()
  where i.id = v_import;
  return null;
end;
$function$;

drop trigger if exists trg_sync_gst_recon_counts on gst_recon_lines;
create trigger trg_sync_gst_recon_counts
after insert or update or delete on gst_recon_lines
-- FOR EACH ROW, not STATEMENT: PL/pgSQL leaves NEW/OLD null in a
-- statement-level trigger, so the import id would be unavailable.
for each row execute function public.sync_gst_recon_counts();

commit;
