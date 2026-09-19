'use client'

import { useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import type { ProductFacets, FilterKey } from '@/lib/product-filters'

const FACET_GROUPS: { key: FilterKey; label: string; param: string }[] = [
  { key: 'brand', label: 'Brand', param: 'brand' },
  { key: 'cpu', label: 'Processor', param: 'cpu' },
  { key: 'ram', label: 'RAM', param: 'ram' },
  { key: 'ssd', label: 'Storage', param: 'ssd' },
  { key: 'gpuType', label: 'Graphics Card', param: 'gpu' },
  { key: 'os', label: 'Operating System', param: 'os' },
  { key: 'warranty', label: 'Warranty', param: 'warranty' },
]

// URL-driven multi-select facet filters, same "state lives in the URL, not
// component state" pattern the ERP's StockView.tsx uses for its own search/
// sort controls -- keeps filters shareable/bookmarkable and survives back/
// forward navigation for free.
export function ProductFilters({ facets }: { facets: ProductFacets }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [mobileOpen, setMobileOpen] = useState(false)

  const getSelected = (param: string) => searchParams.get(param)?.split(',').filter(Boolean) ?? []

  const toggleValue = (param: string, value: string) => {
    const current = getSelected(param)
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    const params = new URLSearchParams(searchParams.toString())
    if (next.length > 0) params.set(param, next.join(',')); else params.delete(param)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const setPrice = (key: 'minPrice' | 'maxPrice', value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value); else params.delete(key)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const hasAnyFilter = [...FACET_GROUPS.map((g) => g.param), 'minPrice', 'maxPrice'].some((p) => searchParams.has(p))

  const clearAll = () => router.push(pathname, { scroll: false })

  const body = (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-semibold text-foreground">Price</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            placeholder={`₹${facets.minPrice}`}
            defaultValue={searchParams.get('minPrice') ?? ''}
            onBlur={(e) => setPrice('minPrice', e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder={`₹${facets.maxPrice}`}
            defaultValue={searchParams.get('maxPrice') ?? ''}
            onBlur={(e) => setPrice('maxPrice', e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      {FACET_GROUPS.map((group) => {
        const options = facets[group.key]
        if (options.length === 0) return null
        const selected = getSelected(group.param)
        return (
          <div key={group.key}>
            <p className="mb-2 text-sm font-semibold text-foreground">{group.label}</p>
            <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
              {options.map((opt) => (
                <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={selected.includes(opt.value)}
                    onChange={() => toggleValue(group.param, opt.value)}
                    className="h-3.5 w-3.5 rounded border-input"
                  />
                  <span className="flex-1 truncate">{opt.value}</span>
                  <span className="text-xs text-muted-foreground">{opt.count}</span>
                </label>
              ))}
            </div>
          </div>
        )
      })}

      {hasAnyFilter && (
        <button type="button" onClick={clearAll} className="text-sm font-medium text-brand-orange underline">
          Clear all filters
        </button>
      )}
    </div>
  )

  return (
    <>
      <div className="mb-4 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground"
        >
          Filters {hasAnyFilter && <span className="text-brand-orange">(active)</span>}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 transition-transform ${mobileOpen ? 'rotate-180' : ''}`}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {mobileOpen && (
          <div className="mt-3 rounded-lg border border-border bg-card p-4">{body}</div>
        )}
      </div>
      <aside className="hidden w-56 shrink-0 lg:block">{body}</aside>
    </>
  )
}
