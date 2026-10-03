-- asset_ledger has no "last modified" timestamp -- a customer return
-- (processCustomerReturn) flips status/qc_status back to qc_pending but
-- touches no timestamp field at all, so a just-returned unit doesn't bubble to
-- the top of Current Stock's "Entry Date" sort (which is actually created_at,
-- the original intake date). Adding a real updated_at column + trigger, same
-- pattern already used by sku_master/sales_documents/purchase_orders/etc.,
-- except via trigger (not per-route app code) so it's impossible to miss a
-- mutation site across the many places that already write to asset_ledger.
alter table public.asset_ledger
  add column if not exists updated_at timestamptz not null default now();

-- Backfill existing rows to their creation date rather than "now" -- the
-- ALTER above stamped every existing row with the single moment the ALTER
-- ran (the default is evaluated once, not per row), which would make every
-- pre-existing unit look freshly modified and defeat the whole point of this
-- sort. Run before the trigger exists so this backfill itself doesn't get
-- overwritten by it.
update public.asset_ledger set updated_at = created_at;

create or replace function public.set_asset_ledger_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_asset_ledger_updated_at on public.asset_ledger;
create trigger trg_asset_ledger_updated_at
  before update on public.asset_ledger
  for each row
  execute function public.set_asset_ledger_updated_at();
