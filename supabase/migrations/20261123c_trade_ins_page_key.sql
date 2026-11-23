-- 'trade_ins' becomes a grantable page (Settings -> Users): the Trade-ins list
-- shows what was paid for each traded-in laptop (a purchase cost), so it is
-- off for staff unless the owner ticks it. View-only -- undo stays owner-only,
-- so it is not added to profile_page_actions' editable keys.
alter table public.profiles drop constraint if exists profiles_allowed_pages_check;
alter table public.profiles add constraint profiles_allowed_pages_check check (allowed_pages <@ array[
  'dashboard', 'pending_tasks', 'new_entry', 'accessories', 'repair_jobs', 'replacement_jobs',
  'sku_master', 'live_stock', 'invoices', 'customers', 'activities', 'sales', 'stock', 'website',
  'expenses', 'reports', 'quotations', 'rma', 'marketing', 'rentals', 'attendance', 'leads',
  'trade_ins'
]::text[]);
