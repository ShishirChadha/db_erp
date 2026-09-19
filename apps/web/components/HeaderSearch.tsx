'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { createBrowserSupabaseClient } from '@db/db/browser'
import { formatCurrency } from '@db/shared'
import { productImageUrl } from '@/lib/image-url'

interface Suggestion {
  id: string
  web_slug: string | null
  web_title: string | null
  brand: string | null
  model_name: string | null
  web_price: number
  primary_image_path: string | null
}

const LIMIT = 6

// Live-as-you-type suggestions under the header search box -- the full
// `/search` results page (search/page.tsx) already shows real ProductCards
// with thumbnails once a search is submitted; this fills the gap before that
// submit, so a visitor sees a short thumbnail list while still typing. Reads
// `public_products` client-direct with the anon key (same precedent as cart
// mutations elsewhere in this app -- no new API route needed for a plain
// public read), debounced so it doesn't fire a query per keystroke.
export function HeaderSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      const supabase = createBrowserSupabaseClient()
      const cleaned = term.replace(/[%_]/g, '')
      const { data } = await supabase
        .from('public_products')
        .select('id, web_slug, web_title, brand, model_name, web_price, primary_image_path')
        .or(`web_title.ilike.%${cleaned}%,brand.ilike.%${cleaned}%,model_name.ilike.%${cleaned}%,full_sku_code.ilike.%${cleaned}%`)
        .order('published_at', { ascending: false })
        .limit(LIMIT)
      setResults((data as Suggestion[] | null) ?? [])
      setActiveIndex(-1)
      setLoading(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  // Close on outside click -- a plain onBlur would fire before a dropdown
  // item's onClick/navigation is registered, swallowing the click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const goToProduct = (slug: string | null) => {
    if (!slug) return
    setOpen(false)
    router.push(`/product/${slug}`)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      goToProduct(results[activeIndex].web_slug)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative ml-auto w-full max-w-xs">
      <form action="/search" className="flex w-full items-center">
        <input
          type="search"
          name="q"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          placeholder="Search laptops, brands..."
          className="w-full rounded-full border border-input bg-background px-3.5 py-1.5 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/30"
        />
      </form>

      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-96 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
          {loading && (
            <p className="p-3 text-sm text-muted-foreground">Searching…</p>
          )}
          {!loading && results.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">No products matched &ldquo;{query}&rdquo;.</p>
          )}
          {!loading && results.map((r, i) => {
            const title = r.web_title || [r.brand, r.model_name].filter(Boolean).join(' ')
            return (
              <Link
                key={r.id}
                href={r.web_slug ? `/product/${r.web_slug}` : '#'}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                  i === activeIndex ? 'bg-secondary' : 'hover:bg-secondary/60'
                }`}
              >
                <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                  {r.primary_image_path && (
                    <Image src={productImageUrl(r.primary_image_path)} alt="" fill sizes="40px" className="object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{title}</span>
                  <span className="block text-xs text-muted-foreground">{formatCurrency(r.web_price)}</span>
                </span>
              </Link>
            )
          })}
          {!loading && results.length > 0 && (
            <Link
              href={`/search?q=${encodeURIComponent(query)}`}
              onClick={() => setOpen(false)}
              className="block border-t border-border px-3 py-2 text-center text-xs font-medium text-brand-blue hover:underline"
            >
              See all results for &ldquo;{query}&rdquo;
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
