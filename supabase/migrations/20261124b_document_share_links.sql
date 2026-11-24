-- Short links for sharing a PI / quotation PDF on WhatsApp (2026-11-24).
--
-- The old link was a ~300-character Supabase signed URL pasted into the
-- message. WhatsApp can't show "click here" text, so the message now carries
-- https://digitalbluez.com/d/<code> instead: a small page with the document's
-- title (WhatsApp shows it as a preview card) and a button that opens a fresh,
-- short-lived signed URL to the PDF in the private `documents` bucket.
--
-- The code (10 characters, 32-letter alphabet, ~50 bits) is the only
-- credential. Service role only: the website's page reads it server-side;
-- anon/authenticated (the key that ships in the website) get nothing.

create table if not exists public.document_share_links (
  code          text primary key check (code ~ '^[a-z2-9]{10}$'),
  document_id   uuid not null references public.sales_documents(id) on delete cascade,
  storage_path  text not null,
  title         text not null,
  expires_at    timestamptz not null,
  created_by    uuid references public.profiles(id),
  open_count    integer not null default 0,
  last_opened_at timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists document_share_links_document_idx on public.document_share_links (document_id);

alter table public.document_share_links enable row level security;
revoke all on public.document_share_links from anon, authenticated;
grant all on public.document_share_links to service_role;

comment on table public.document_share_links is
  'Short WhatsApp links to a PI/quotation PDF (digitalbluez.com/d/<code>). Service role only.';
