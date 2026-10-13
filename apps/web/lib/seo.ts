import type { Metadata } from 'next'

// Storefront-only SEO helpers. Nothing here changes ERP data or ERP output.

// Placeholder-value helpers live in @db/shared so the ERP's publish dialog and
// the storefront agree on what counts as "not applicable".
export { isPlaceholderValue, cleanSpecifications, stripPlaceholderSegments } from '@db/shared'

// Plural, human labels for category pages. The previous code appended a bare
// "s" to the ERP's display_name, which produced "Accessory (General)s",
// "Mouses" and "Others". Keyed by category code; unknown codes fall back to
// the ERP display name unchanged.
const CATEGORY_PLURAL_LABELS: Record<string, string> = {
  LAP: 'Laptops',
  DES: 'Desktops',
  MON: 'Monitors',
  TAB: 'Tablets',
  SSD: 'SSDs',
  RAM: 'RAM',
  CPU: 'Processors',
  GPU: 'Graphics Cards',
  KBD: 'Keyboards',
  MOUSE: 'Mice',
  ADP: 'Adapters & Chargers',
  ACC: 'Accessories',
  OTHER: 'Other Products',
  CCTV: 'CCTV Cameras',
}

export function categoryPluralLabel(code: string, displayName: string): string {
  return CATEGORY_PLURAL_LABELS[code] ?? displayName
}

// Categories whose items are sold as whole refurbished machines. Accessories
// and components are not marketed as "refurbished" (see product-title.ts).
const REFURBISHED_MACHINE_CATEGORIES = new Set(['LAP', 'DES', 'MON', 'TAB'])

export function isRefurbishedMachine(code: string): boolean {
  return REFURBISHED_MACHINE_CATEGORIES.has(code)
}

// Every laptop, desktop, monitor and tablet carries the 6-month warranty (owner
// decision 2026-10-13, see /warranty), so an unlabelled one shows it rather than
// "no warranty". Accessories keep exactly the label set on the SKU (or none).
export const DEFAULT_MACHINE_WARRANTY = '6 Months'
export function effectiveWarrantyLabel(category: string, label: string | null): string | null {
  return label ?? (REFURBISHED_MACHINE_CATEGORIES.has(category) ? DEFAULT_MACHINE_WARRANTY : null)
}

export function categoryHeading(code: string, displayName: string): string {
  const label = categoryPluralLabel(code, displayName)
  return REFURBISHED_MACHINE_CATEGORIES.has(code) ? `Refurbished ${label}` : label
}

// Private / transactional pages: never useful in search results. Deliberately
// not disallowed in robots.txt, so crawlers can actually see this tag.
export function privatePageMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: false } }
}
