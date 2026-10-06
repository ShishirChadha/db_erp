'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { SORT_OPTIONS, type SortKey } from '@/lib/product-filters'

// Sort select (+ an "in stock only" checkbox on pages that don't already
// have ProductFilters' sidebar for it) shared by every listing/search
// surface -- category pages with facets, category pages without, and
// /search. Same "state lives in the URL" pattern as ProductFilters.tsx, so
// it stays shareable/bookmarkable and doesn't duplicate that component's
// own in-stock checkbox on the two filterable categories.
export function ListingToolbar({ showAvailability = false }: { showAvailability?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const sort = (searchParams.get('sort') as SortKey) || 'featured'
  const inStockOnly = searchParams.get('availability') === 'in_stock'

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value); else params.delete(key)
    params.delete('page') // a changed sort/filter invalidates whatever page you were on
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="flex items-center gap-4">
      {showAvailability && (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={() => setParam('availability', inStockOnly ? null : 'in_stock')}
            className="h-3.5 w-3.5 rounded border-input"
          />
          In stock only
        </label>
      )}
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        Sort
        <select
          value={sort}
          onChange={(e) => setParam('sort', e.target.value === 'featured' ? null : e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
