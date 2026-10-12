import type { PublicProduct } from './queries'
import {
  EMPTY_FILTERS,
  filterProducts,
  gpuType,
  normalizeFilterKey,
  specValue,
  type FilterKey,
  type SelectedFilters,
} from '@db/shared'

// Matching rules live in @db/shared (product-filter-core.ts) so the ERP's
// collection previews and these pages can never disagree. Re-exported so
// existing imports from './product-filters' keep working.
export { EMPTY_FILTERS, filterProducts, gpuType }
export type { FilterKey, SelectedFilters }

// Only used on category pages small enough to fetch in full and filter in
// application code (Laptops/Desktops top out around 200 published SKUs each
// today) -- avoids composing brittle per-field jsonb SQL for messy free-text
// spec values ("16GB" vs "16 GB", "i7" vs "Core i7", etc).

// Sort options shown on every listing/search surface. 'featured' is the
// existing default (published_at desc) left exactly as-is -- there was no
// sort UI at all before this, so nothing regresses for someone who doesn't
// touch the control.
export type SortKey = 'featured' | 'price_asc' | 'price_desc' | 'newest'

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'newest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
]

export function parseSort(sp: Record<string, string | string[] | undefined>): SortKey {
  const v = Array.isArray(sp.sort) ? sp.sort[0] : sp.sort
  return SORT_OPTIONS.some((o) => o.value === v) ? (v as SortKey) : 'featured'
}

// Applied client/server-side (in-memory) for the filterable category pages,
// which already hold the full array for facet counting. The DB-paginated
// path (getPublishedProductsPage) takes the same SortKey and translates it
// into a Postgres .order() instead -- see queries.ts.
export function applySort(products: PublicProduct[], sort: SortKey): PublicProduct[] {
  if (sort === 'price_asc') return [...products].sort((a, b) => a.web_price - b.web_price)
  if (sort === 'price_desc') return [...products].sort((a, b) => b.web_price - a.web_price)
  if (sort === 'newest') {
    return [...products].sort(
      (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    )
  }
  return products // 'featured' -- already published_at desc from the query itself
}

const normalizeKey = normalizeFilterKey

interface Facet {
  value: string
  count: number
}

export interface ProductFacets {
  brand: Facet[]
  cpu: Facet[]
  ram: Facet[]
  ssd: Facet[]
  gpuType: Facet[]
  os: Facet[]
  warranty: Facet[]
  minPrice: number
  maxPrice: number
  inStockCount: number
  totalCount: number
}

function buildFacet(products: PublicProduct[], getValue: (p: PublicProduct) => string | null): Facet[] {
  const byKey = new Map<string, { label: string; count: number }>()
  for (const p of products) {
    const raw = getValue(p)
    if (!raw) continue
    const key = normalizeKey(raw)
    const existing = byKey.get(key)
    if (existing) existing.count += 1
    else byKey.set(key, { label: raw, count: 1 })
  }
  return [...byKey.values()]
    .map(({ label, count }) => ({ value: label, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

export function getFilterFacets(products: PublicProduct[]): ProductFacets {
  const prices = products.map((p) => p.web_price).filter((n) => typeof n === 'number')
  return {
    brand: buildFacet(products, (p) => p.brand),
    cpu: buildFacet(products, (p) => specValue(p, 'cpu')),
    ram: buildFacet(products, (p) => specValue(p, 'ram')),
    ssd: buildFacet(products, (p) => specValue(p, 'ssd')),
    gpuType: buildFacet(products, (p) => gpuType(specValue(p, 'gpu'))),
    os: buildFacet(products, (p) => specValue(p, 'os')),
    warranty: buildFacet(products, (p) => p.warranty_label),
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    inStockCount: products.filter((p) => p.availability_bucket !== 'sold_out').length,
    totalCount: products.length,
  }
}

// Parses the page's searchParams (repeated ?brand=X&brand=Y or comma-joined,
// either works since URLSearchParams.getAll handles the former and callers
// can still pass a single comma value) into SelectedFilters.
export function parseFiltersFromSearchParams(sp: Record<string, string | string[] | undefined>): SelectedFilters {
  const list = (key: string): string[] => {
    const v = sp[key]
    if (!v) return []
    const arr = Array.isArray(v) ? v : [v]
    return arr.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean)
  }
  const num = (key: string): number | null => {
    const v = sp[key]
    const n = Number(Array.isArray(v) ? v[0] : v)
    return Number.isFinite(n) && (Array.isArray(v) ? v[0] : v) ? n : null
  }
  return {
    brand: list('brand'),
    cpu: list('cpu'),
    ram: list('ram'),
    ssd: list('ssd'),
    gpuType: list('gpu'),
    os: list('os'),
    warranty: list('warranty'),
    minPrice: num('minPrice'),
    maxPrice: num('maxPrice'),
    inStockOnly: (Array.isArray(sp.availability) ? sp.availability[0] : sp.availability) === 'in_stock',
  }
}
