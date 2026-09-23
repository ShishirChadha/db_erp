// Pretty, stable URL slugs for each sku_category_templates category code.
// Kept as a small hand-maintained map (13 categories total) rather than
// deriving slugs from display_name, so a category's display name can be
// edited in the ERP without silently breaking every indexed product/category
// URL for that category.
export const CATEGORY_SLUGS: Record<string, string> = {
  LAP: 'laptops',
  DES: 'desktops',
  MON: 'monitors',
  TAB: 'tablets',
  SSD: 'ssd',
  RAM: 'ram',
  CPU: 'processors',
  GPU: 'graphics-cards',
  KBD: 'keyboards',
  MOUSE: 'mice',
  ADP: 'adapters-chargers',
  ACC: 'accessories',
  OTHER: 'other',
  CCTV: 'cctv',
}

const SLUG_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_SLUGS).map(([code, slug]) => [slug, code])
)

export function categoryToSlug(category: string): string {
  return CATEGORY_SLUGS[category] || category.toLowerCase()
}

export function slugToCategory(slug: string): string | null {
  return SLUG_TO_CATEGORY[slug] || null
}

// Top-level category nav links shared by SiteHeader's desktop nav and
// MobileNav's drawer -- kept in one place so the two can never drift apart.
export const NAV_CATEGORIES = [
  { code: 'LAP', label: 'Laptops' },
  { code: 'DES', label: 'Desktops' },
  { code: 'MON', label: 'Monitors' },
  { code: 'TAB', label: 'Tablets' },
]
