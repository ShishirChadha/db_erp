import { buildConfigSummary, type ConfigSummaryTemplate } from '@db/shared'

// Categories that get the "Certified Refurbished" prefix on the storefront.
// Owner's call (2026-10-06): laptops/desktops/monitors/tablets, not
// accessories -- a RAM stick or mouse isn't marketed as "refurbished" the same
// way a whole machine is. Drop a code here to narrow the scope later.
const CERTIFIED_CATEGORIES = new Set(['LAP', 'DES', 'MON', 'TAB'])

// Already says "refurbished" somewhere (owner-curated web_title, or a
// category/brand name that happens to contain the word) -- skip the prefix so
// we never produce "Certified Refurbished ... Refurbished Laptop".
const ALREADY_REFURBISHED = /refurb/i

export interface ProductTitleInput {
  web_title?: string | null
  brand?: string | null
  model_name?: string | null
  category?: string | null
  specifications?: Record<string, unknown> | null
}

// The one place every storefront surface should get a product's display
// title from. Previously this fallback chain (web_title -> config summary ->
// brand+model) was inlined separately at 8+ call sites in three slightly
// different variants -- which is how a "Certified Refurbished" prefix could
// easily have ended up applied in some places and not others.
export function productDisplayTitle(
  product: ProductTitleInput,
  templates: ConfigSummaryTemplate[] = []
): string {
  const base =
    product.web_title ||
    buildConfigSummary(product.category, product.specifications, templates) ||
    [product.brand, product.model_name].filter(Boolean).join(' ') ||
    'Product'

  if (!product.category || !CERTIFIED_CATEGORIES.has(product.category)) return base
  if (ALREADY_REFURBISHED.test(base)) return base
  return `Certified Refurbished ${base}`
}
