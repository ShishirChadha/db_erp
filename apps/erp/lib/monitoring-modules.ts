// Attributes every table in the database to a feature/module, purely for the
// System Health "size by feature" breakdown -- a decision-support view, not a
// usage-analytics system. It answers "what is actually taking up space" from
// data Postgres already tracks for its own housekeeping (pg_class/
// pg_stat_user_tables), not from any new request logging -- that would mean
// adding tracking overhead to every page, which is exactly the load this is
// meant to avoid. Row count is used as a rough usage proxy (a module with a
// lot of space but almost no rows is template/seed data, not active use);
// there is no per-feature request-count metric and this deliberately doesn't
// try to build one.
//
// A table not listed here falls into 'Other / Unmapped' rather than being
// guessed at or omitted -- same "unknown degrades quietly" rule the page's
// own TABLE_INFO map already follows. When a new table is added, it will
// simply show up there until someone adds it below.
export type AppOwner = 'erp' | 'website'

export const TABLE_MODULES: Record<string, { module: string; app: AppOwner }> = {
  // Live Stock / Inventory
  asset_ledger: { module: 'Live Stock / Inventory', app: 'erp' },
  asset_qc_checks: { module: 'Live Stock / Inventory', app: 'erp' },
  asset_cost_adjustments: { module: 'Live Stock / Inventory', app: 'erp' },
  asset_counters: { module: 'Live Stock / Inventory', app: 'erp' },
  stock_movements: { module: 'Live Stock / Inventory', app: 'erp' },
  sku_master: { module: 'Live Stock / Inventory', app: 'erp' },
  sku_category_templates: { module: 'Live Stock / Inventory', app: 'erp' },
  reorder_rules: { module: 'Live Stock / Inventory', app: 'erp' },
  market_price_observations: { module: 'Live Stock / Inventory', app: 'erp' },

  // Sales Ledger
  sales: { module: 'Sales Ledger', app: 'erp' },
  sale_payments: { module: 'Sales Ledger', app: 'erp' },

  // Invoices
  invoices: { module: 'Invoices', app: 'erp' },
  invoice_items: { module: 'Invoices', app: 'erp' },
  invoice_sequences: { module: 'Invoices', app: 'erp' },

  // Quotations & Proforma
  sales_documents: { module: 'Quotations & Proforma', app: 'erp' },
  sales_document_items: { module: 'Quotations & Proforma', app: 'erp' },

  // Purchasing
  purchase_orders: { module: 'Purchasing', app: 'erp' },
  purchase_order_items: { module: 'Purchasing', app: 'erp' },
  purchase_files: { module: 'Purchasing', app: 'erp' },
  purchases: { module: 'Purchasing', app: 'erp' },
  po_counter: { module: 'Purchasing', app: 'erp' },
  vendors: { module: 'Purchasing', app: 'erp' },
  vendor_payments: { module: 'Purchasing', app: 'erp' },

  // Repair Jobs
  repair_jobs: { module: 'Repair Jobs', app: 'erp' },
  repair_job_parts: { module: 'Repair Jobs', app: 'erp' },
  repair_job_counter: { module: 'Repair Jobs', app: 'erp' },

  // Replacement Jobs
  replacement_jobs: { module: 'Replacement Jobs', app: 'erp' },
  replacement_job_parts: { module: 'Replacement Jobs', app: 'erp' },
  replacement_job_counter: { module: 'Replacement Jobs', app: 'erp' },
  accessory_replacement_jobs: { module: 'Replacement Jobs', app: 'erp' },
  accessory_replacement_job_parts: { module: 'Replacement Jobs', app: 'erp' },

  // RMA
  asset_rma_events: { module: 'RMA / Returns', app: 'erp' },
  accessory_rma_events: { module: 'RMA / Returns', app: 'erp' },

  // Rentals
  rental_agreements: { module: 'Rentals', app: 'erp' },
  rental_agreement_items: { module: 'Rentals', app: 'erp' },
  rental_agreement_counter: { module: 'Rentals', app: 'erp' },

  // Activities / Tasks
  activities: { module: 'Activities / Tasks', app: 'erp' },
  activity_comments: { module: 'Activities / Tasks', app: 'erp' },
  activity_assignees: { module: 'Activities / Tasks', app: 'erp' },
  activity_watchers: { module: 'Activities / Tasks', app: 'erp' },
  activity_checklist_items: { module: 'Activities / Tasks', app: 'erp' },
  activity_comment_reactions: { module: 'Activities / Tasks', app: 'erp' },
  notifications: { module: 'Activities / Tasks', app: 'erp' },

  // Customers / CRM
  customers: { module: 'Customers', app: 'erp' },

  // Expenses
  expenses: { module: 'Expenses', app: 'erp' },
  expense_reimbursements: { module: 'Expenses', app: 'erp' },
  recurring_expense_rules: { module: 'Expenses', app: 'erp' },

  // Bank Reconciliation
  bank_accounts: { module: 'Bank Reconciliation', app: 'erp' },
  bank_transactions: { module: 'Bank Reconciliation', app: 'erp' },
  bank_transaction_matches: { module: 'Bank Reconciliation', app: 'erp' },
  bank_statements: { module: 'Bank Reconciliation', app: 'erp' },
  bank_column_profiles: { module: 'Bank Reconciliation', app: 'erp' },
  bank_categorization_rules: { module: 'Bank Reconciliation', app: 'erp' },
  recon_sessions: { module: 'Bank Reconciliation', app: 'erp' },

  // Vendor Recon (AI invoice extraction)
  vendor_correction_proposals: { module: 'Vendor Recon', app: 'erp' },
  extraction_templates: { module: 'Vendor Recon', app: 'erp' },
  uploaded_documents: { module: 'Vendor Recon', app: 'erp' },

  // Marketing / Digests
  marketing_assets: { module: 'Marketing / Digests', app: 'erp' },
  marketing_settings: { module: 'Marketing / Digests', app: 'erp' },
  digest_subscriptions: { module: 'Marketing / Digests', app: 'erp' },
  digest_channel_config: { module: 'Marketing / Digests', app: 'erp' },
  digest_runs: { module: 'Marketing / Digests', app: 'erp' },
  festival_calendar: { module: 'Marketing / Digests', app: 'erp' },

  // Website / Storefront
  orders: { module: 'Website / Storefront', app: 'website' },
  order_items: { module: 'Website / Storefront', app: 'website' },
  cart_items: { module: 'Website / Storefront', app: 'website' },
  web_reservations: { module: 'Website / Storefront', app: 'website' },
  customer_profiles: { module: 'Website / Storefront', app: 'website' },
  promotions: { module: 'Website / Storefront', app: 'website' },
  promotion_redemptions: { module: 'Website / Storefront', app: 'website' },
  wishlist_items: { module: 'Website / Storefront', app: 'website' },
  newsletter_subscribers: { module: 'Website / Storefront', app: 'website' },
  sku_upgrade_rules: { module: 'Website / Storefront', app: 'website' },
  sku_cross_sell_rules: { module: 'Website / Storefront', app: 'website' },
  homepage_banners: { module: 'Website / Storefront', app: 'website' },
  blog_posts: { module: 'Website / Storefront', app: 'website' },
  product_images: { module: 'Website / Storefront', app: 'website' },

  // Staff / Access Control
  profiles: { module: 'Staff / Access Control', app: 'erp' },
  profile_page_actions: { module: 'Staff / Access Control', app: 'erp' },
  user_sessions: { module: 'Staff / Access Control', app: 'erp' },
  users: { module: 'Staff / Access Control', app: 'erp' },

  // Settings / Config
  business_profiles: { module: 'Settings / Config', app: 'erp' },
  custom_options: { module: 'Settings / Config', app: 'erp' },
  app_settings: { module: 'Settings / Config', app: 'erp' },
  backup_settings: { module: 'Settings / Config', app: 'erp' },
  redaction_rules: { module: 'Settings / Config', app: 'erp' },
  sac_codes: { module: 'Settings / Config', app: 'erp' },

  // System / Audit
  audit_log: { module: 'System / Audit', app: 'erp' },
  server_metrics: { module: 'System / Audit', app: 'erp' },
  server_boot_events: { module: 'System / Audit', app: 'erp' },
  website_health_checks: { module: 'System / Audit', app: 'erp' },
  backup_snapshots: { module: 'System / Audit', app: 'erp' },
  field_corrections: { module: 'System / Audit', app: 'erp' },
  document_sends: { module: 'System / Audit', app: 'erp' },
  _migration_tracking: { module: 'System / Audit', app: 'erp' },

  // Docs / KB
  kb_chapters: { module: 'Docs / KB Guide', app: 'erp' },
  kb_chapter_sections: { module: 'Docs / KB Guide', app: 'erp' },
}

export interface TableSize {
  table_name: string
  total_bytes: number
  row_estimate: number
}

export interface ModuleRollup {
  module: string
  app: AppOwner | 'mixed'
  bytes: number
  rows: number
  tableCount: number
}

// Groups the full table list into modules and sums bytes/rows per module --
// pure aggregation over numbers Postgres already computed, no extra queries.
export function rollupByModule(tables: TableSize[]): ModuleRollup[] {
  const byModule = new Map<string, ModuleRollup>()
  for (const t of tables) {
    const entry = TABLE_MODULES[t.table_name]
    const module = entry?.module ?? 'Other / Unmapped'
    const app = entry?.app ?? 'erp'
    const existing = byModule.get(module)
    if (existing) {
      existing.bytes += t.total_bytes
      existing.rows += t.row_estimate
      existing.tableCount += 1
      if (existing.app !== app) existing.app = 'mixed'
    } else {
      byModule.set(module, { module, app, bytes: t.total_bytes, rows: t.row_estimate, tableCount: 1 })
    }
  }
  return [...byModule.values()].sort((a, b) => b.bytes - a.bytes)
}

// The coarse ERP-vs-Website split the health page shows up top.
export function rollupByApp(tables: TableSize[]): Record<AppOwner, { bytes: number; rows: number }> {
  const totals: Record<AppOwner, { bytes: number; rows: number }> = {
    erp: { bytes: 0, rows: 0 },
    website: { bytes: 0, rows: 0 },
  }
  for (const t of tables) {
    const app = TABLE_MODULES[t.table_name]?.app ?? 'erp'
    totals[app].bytes += t.total_bytes
    totals[app].rows += t.row_estimate
  }
  return totals
}
