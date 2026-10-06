'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { formatCurrency } from '@db/shared'
import { productImageUrl } from '@/lib/image-url'

interface ProductHit {
  id: string
  web_slug: string | null
  display_title: string
  web_price: number
  primary_image_path: string | null
  availability_bucket: 'in_stock' | 'low_stock' | 'sold_out'
}

interface BlogHit {
  slug: string
  title: string
  excerpt: string | null
}

interface SearchResponse {
  products: ProductHit[]
  blogPosts: BlogHit[]
  related: ProductHit[]
}

const EMPTY_RESULTS: SearchResponse = { products: [], blogPosts: [], related: [] }

// Live-as-you-type suggestions under the header search box. Reads the
// server-side /api/search route (not Supabase client-direct any more --
// moving it server-side is what let one request feed all three tiers
// below, and fixed %/_ not being escaped in the ilike term).
//
// The panel shows up to two columns: Products (left) and a secondary
// column (right) chosen by what's actually useful -- 3+ product matches
// need nothing else; fewer than that, blog posts fill the gap; no blog
// matches either, "You might also like" (reusing the same cross-sell
// categories the product page's "Complete your setup" uses) fills it
// instead, so the panel is never just a short, lonely list.
//
// Below `md:`, a search icon opens a full-width overlay panel instead --
// same portal/scroll-lock technique as MobileNav, for the same reason:
// SiteHeader's `backdrop-blur` creates a CSS containing block that clips a
// `fixed` child to the header's own ~70px height. The desktop panel is
// portaled too now that it's wide enough to want to break out of its
// anchor's narrow box -- positioned by measuring the input's own
// bounding rect rather than relying on CSS containment.
export function HeaderSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResponse>(EMPTY_RESULTS)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [panelStyle, setPanelStyle] = useState<{ top: number; right: number; width: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const mobileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setResults(EMPTY_RESULTS)
      setLoading(false)
      return
    }
    setLoading(true)
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        const data = res.ok ? ((await res.json()) as SearchResponse) : EMPTY_RESULTS
        setResults(data)
      } catch {
        // AbortError from a superseded keystroke -- nothing to show for it.
      } finally {
        setActiveIndex(-1)
        setLoading(false)
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  // Position the desktop panel against the input's real screen position --
  // not CSS anchoring -- so it can be wider than the input and still never
  // get clipped by the header's backdrop-blur containing block.
  const updatePanelPosition = useCallback(() => {
    const rect = inputRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(720, window.innerWidth - 32)
    setPanelStyle({ top: rect.bottom + 8, right: Math.max(16, window.innerWidth - rect.right), width })
  }, [])

  useEffect(() => {
    if (!open) return
    updatePanelPosition()
    window.addEventListener('resize', updatePanelPosition)
    window.addEventListener('scroll', updatePanelPosition, true)
    return () => {
      window.removeEventListener('resize', updatePanelPosition)
      window.removeEventListener('scroll', updatePanelPosition, true)
    }
  }, [open, updatePanelPosition])

  // Close on outside click -- a plain onBlur would fire before a dropdown
  // item's onClick/navigation is registered, swallowing the click. The
  // portaled panel lives outside containerRef, so it's excluded by its own
  // data attribute instead.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (containerRef.current && !containerRef.current.contains(target) && !target.closest('[data-search-panel]')) {
        setOpen(false)
      }
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

  // One flat, ordered list for keyboard nav across both columns -- products
  // first, then whichever secondary column is showing -- so arrow keys
  // traverse the whole panel linearly regardless of the two-column layout.
  const flatNav: { href: string }[] = [
    ...results.products.map((p) => ({ href: p.web_slug ? `/product/${p.web_slug}` : '#' })),
    ...results.blogPosts.map((b) => ({ href: `/blog/${b.slug}` })),
    ...results.related.map((p) => ({ href: p.web_slug ? `/product/${p.web_slug}` : '#' })),
  ]

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (flatNav.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % flatNav.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + flatNav.length) % flatNav.length)
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      closeAll()
      router.push(flatNav[activeIndex].href)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showSecondary = results.products.length < 3
  const secondaryIsBlog = showSecondary && results.blogPosts.length > 0
  const secondaryIsRelated = showSecondary && !secondaryIsBlog && results.related.length > 0
  let navIdx = -1

  const panel = (
    <div data-search-panel className="max-h-[75vh] overflow-y-auto">
      {loading && <p className="p-3 text-sm text-muted-foreground">Searching…</p>}
      {!loading && results.products.length === 0 && results.blogPosts.length === 0 && results.related.length === 0 && (
        <p className="p-3 text-sm text-muted-foreground">No products matched &ldquo;{query}&rdquo;.</p>
      )}
      {!loading && (results.products.length > 0 || secondaryIsBlog || secondaryIsRelated) && (
        <div className={`grid gap-0 ${secondaryIsBlog || secondaryIsRelated ? 'sm:grid-cols-2' : ''}`}>
          {results.products.length > 0 && (
            <div className={secondaryIsBlog || secondaryIsRelated ? 'sm:border-r sm:border-border' : ''}>
              <p className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Products</p>
              {results.products.map((p) => {
                navIdx += 1
                const idx = navIdx
                return (
                  <Link
                    key={p.id}
                    href={p.web_slug ? `/product/${p.web_slug}` : '#'}
                    onClick={closeAll}
                    className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                      idx === activeIndex ? 'bg-secondary' : 'hover:bg-secondary/60'
                    }`}
                  >
                    <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                      {p.primary_image_path && (
                        <Image src={productImageUrl(p.primary_image_path)} alt="" fill sizes="40px" className="object-contain" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{p.display_title}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {formatCurrency(p.web_price)}
                        {p.availability_bucket === 'sold_out' && <span className="text-destructive">· Sold out</span>}
                        {p.availability_bucket === 'low_stock' && <span className="text-amber-600">· Few left</span>}
                      </span>
                    </span>
                  </Link>
                )
              })}
            </div>
          )}

          {secondaryIsBlog && (
            <div>
              <p className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">From the blog</p>
              {results.blogPosts.map((b) => {
                navIdx += 1
                const idx = navIdx
                return (
                  <Link
                    key={b.slug}
                    href={`/blog/${b.slug}`}
                    onClick={closeAll}
                    className={`block px-3 py-2 text-sm transition-colors ${idx === activeIndex ? 'bg-secondary' : 'hover:bg-secondary/60'}`}
                  >
                    <span className="block font-medium text-foreground">{b.title}</span>
                    {b.excerpt && <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{b.excerpt}</span>}
                  </Link>
                )
              })}
            </div>
          )}

          {secondaryIsRelated && (
            <div>
              <p className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">You might also like</p>
              {results.related.map((p) => {
                navIdx += 1
                const idx = navIdx
                return (
                  <Link
                    key={p.id}
                    href={p.web_slug ? `/product/${p.web_slug}` : '#'}
                    onClick={closeAll}
                    className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                      idx === activeIndex ? 'bg-secondary' : 'hover:bg-secondary/60'
                    }`}
                  >
                    <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                      {p.primary_image_path && (
                        <Image src={productImageUrl(p.primary_image_path)} alt="" fill sizes="40px" className="object-contain" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{p.display_title}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      )}
      {!loading && results.products.length > 0 && (
        <Link
          href={`/search?q=${encodeURIComponent(query)}`}
          onClick={closeAll}
          className="block border-t border-border px-3 py-2 text-center text-xs font-medium text-brand-blue hover:underline"
        >
          See all results for &ldquo;{query}&rdquo;
        </Link>
      )}
    </div>
  )

  return (
    <>
      {/* Desktop/tablet: inline box; the panel itself is portaled (see
          updatePanelPosition) so its width isn't constrained by this box. */}
      <div ref={containerRef} className="relative ml-auto hidden w-full max-w-xs md:block">
        <form action="/search" className="flex w-full items-center">
          <input
            ref={inputRef}
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
      </div>

      {open && query.trim().length >= 2 && mounted && panelStyle &&
        createPortal(
          <div
            data-search-panel
            className="fixed z-50 rounded-xl border border-border bg-card shadow-lg"
            style={{ top: panelStyle.top, right: panelStyle.right, width: panelStyle.width }}
          >
            {panel}
          </div>,
          document.body
        )}

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
              {query.trim().length >= 2 && panel}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
