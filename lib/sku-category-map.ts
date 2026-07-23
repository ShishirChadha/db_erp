// Maps the Purchases/Stock Intake "type" field to a sku_category_templates category
// code. Client-safe (no server imports) so both client components and server-only
// lib/purchases-legacy.ts can share one definition instead of drifting apart.
export const TYPE_TO_CATEGORY: Record<string, string> = {
  Laptop: 'LAP',
  Desktop: 'DES',
  Monitor: 'MON',
  Tablet: 'TAB',
  Tiny: 'DES',
}
