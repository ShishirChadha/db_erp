// The matching rules behind the storefront's listing filters, kept free of any
// app types so the ERP (collection pages preview) and apps/web (the real pages)
// are guaranteed to agree on what "Dell laptops under 20000" matches.

export interface FilterableProduct {
  brand: string | null
  specifications: Record<string, unknown> | null
  web_price: number
  availability_bucket: 'in_stock' | 'low_stock' | 'sold_out'
  warranty_label: string | null
}

export type FilterKey = 'brand' | 'cpu' | 'ram' | 'ssd' | 'gpuType' | 'os' | 'warranty'

export interface SelectedFilters {
  brand: string[]
  cpu: string[]
  ram: string[]
  ssd: string[]
  gpuType: string[]
  os: string[]
  warranty: string[]
  minPrice: number | null
  maxPrice: number | null
  inStockOnly: boolean
}

export const EMPTY_FILTERS: SelectedFilters = {
  brand: [], cpu: [], ram: [], ssd: [], gpuType: [], os: [], warranty: [],
  minPrice: null, maxPrice: null, inStockOnly: false,
}

// Groups values that only differ by whitespace/case ("16GB" / "16 GB" / "16gb").
export function normalizeFilterKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

const INTEGRATED_GPU_PATTERNS = /^(|-|none|n\/a|integrated|onboard|intel (uhd|iris|hd) graphics.*)$/i

export function gpuType(gpuValue: unknown): 'Integrated' | 'Dedicated' | null {
  const v = typeof gpuValue === 'string' ? gpuValue.trim() : ''
  if (!v) return 'Integrated'
  return INTEGRATED_GPU_PATTERNS.test(v) ? 'Integrated' : 'Dedicated'
}

export function specValue(p: { specifications: Record<string, unknown> | null }, field: string): string | null {
  const v = (p.specifications as Record<string, unknown> | null)?.[field]
  return typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null
}

function matchesAny(selected: string[], raw: string | null): boolean {
  if (selected.length === 0) return true
  if (!raw) return false
  const key = normalizeFilterKey(raw)
  return selected.some((s) => normalizeFilterKey(s) === key)
}

export function filterProducts<T extends FilterableProduct>(products: T[], filters: SelectedFilters): T[] {
  return products.filter((p) => {
    if (filters.inStockOnly && p.availability_bucket === 'sold_out') return false
    if (filters.minPrice != null && p.web_price < filters.minPrice) return false
    if (filters.maxPrice != null && p.web_price > filters.maxPrice) return false
    if (!matchesAny(filters.brand, p.brand)) return false
    if (!matchesAny(filters.cpu, specValue(p, 'cpu'))) return false
    if (!matchesAny(filters.ram, specValue(p, 'ram'))) return false
    if (!matchesAny(filters.ssd, specValue(p, 'ssd'))) return false
    if (!matchesAny(filters.gpuType, gpuType(specValue(p, 'gpu')))) return false
    if (!matchesAny(filters.os, specValue(p, 'os'))) return false
    if (!matchesAny(filters.warranty, p.warranty_label)) return false
    return true
  })
}

// A stored collection filter (jsonb) -> a full SelectedFilters, ignoring
// anything unknown or mistyped rather than throwing.
export function filtersFromJson(json: unknown): SelectedFilters {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const list = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [])
  const num = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k] as number) ? (o[k] as number) : null)
  return {
    brand: list('brand'), cpu: list('cpu'), ram: list('ram'), ssd: list('ssd'),
    gpuType: list('gpuType'), os: list('os'), warranty: list('warranty'),
    minPrice: num('minPrice'), maxPrice: num('maxPrice'), inStockOnly: false,
  }
}
