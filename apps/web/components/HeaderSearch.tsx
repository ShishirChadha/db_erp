'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { createBrowserSupabaseClient } from '@db/db/browser'
import { formatCurrency } from '@db/shared'
import { productImageUrl } from '@/lib/image-url'
import { productDisplayTitle } from '@/lib/product-title'

interface Suggestion {
  id: string
  web_slug: string | null
  web_title: string | null
  brand: string | null
  model_name: string | null
  category: string | null
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
//
// Below `md:`, the inline box+dropdown used to be squeezed into whatever
// space was left over next to the logo and account icons -- too small to
// type into, and the suggestion dropdown (pinned to that same narrow box)
// was effectively unusable. Below `md:` this instead renders a search icon
// that opens a full-width overlay panel (same portal/scroll-lock technique
// as MobileNav, for the same reason: SiteHeader's `backdrop-blur` creates a
// CSS containing block that would otherwise clip a `fixed` panel to the
// header's own ~70px height).
export function HeaderSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const mobileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setMounted(true), [])

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
        .select('id, web_slug, web_title, brand, model_name, category, web_price, primary_image_path')
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

  // Mobile overlay: lock background scroll while open, autofocus the input,
  // and let Escape close it -- matching MobileNav's drawer exactly.
  useEffect(() => {
    if (!mobileOpen) return
    mobileInputRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKey)
    }
  }, [mobileOpen])

  const closeAll = () => {
    setOpen(false)
    setMobileOpen(false)
  }

  const goToProduct = (slug: string | null) => {
    if (!slug) return
    closeAll()
    router.push(`/product/${slug}`)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return
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

  const suggestions = (
    <>
      {loading && <p className="p-3 text-sm text-muted-foreground">Searching…</p>}
      {!loading && results.length === 0 && (
        <p className="p-3 text-sm text-muted-foreground">No products matched &ldquo;{query}&rdquo;.</p>
      )}
      {!loading && results.map((r, i) => {
        const title = productDisplayTitle(r)
        return (
          <Link
            key={r.id}
            href={r.web_slug ? `/product/${r.web_slug}` : '#'}
            onClick={closeAll}
            className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
              i === activeIndex ? 'bg-secondary' : 'hover:bg-secondary/60'
            }`}
          >
            <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
              {r.primary_image_path && (
                <Image src={productImageUrl(r.primary_image_path)} alt="" fill sizes="40px" className="object-contain" />
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
          onClick={closeAll}
          className="block border-t border-border px-3 py-2 text-center text-xs font-medium text-brand-blue hover:underline"
        >
          See all results for &ldquo;{query}&rdquo;
        </Link>
      )}
    </>
  )

  return (
    <>
      {/* Desktop/tablet: inline box with the dropdown anchored directly under it. */}
      <div ref={containerRef} className="relative ml-auto hidden w-full max-w-xs md:block">
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
            {suggestions}
          </div>
        )}
      </div>

      {/* Mobile: icon that opens a full-viewport-width overlay, so the input
          and its suggestions are never squeezed into leftover header space. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Search"
        className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-secondary/60 md:hidden"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      </button>

      {mobileOpen && mounted && createPortal(
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close search"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <div className="absolute inset-x-0 top-0 flex max-h-[85vh] flex-col overflow-hidden border-b border-border bg-card shadow-lg">
            <form action="/search" className="flex items-center gap-2 border-b border-border p-3">
              <input
                ref={mobileInputRef}
                type="search"
                name="q"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                placeholder="Search laptops, brands..."
                className="w-full rounded-full border border-input bg-background px-3.5 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/30"
              />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="shrink-0 text-sm font-medium text-muted-foreground"
              >
                Cancel
              </button>
            </form>
            <div className="overflow-y-auto">
              {query.trim().length >= 2 && suggestions}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
