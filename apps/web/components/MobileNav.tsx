'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { categoryToSlug, NAV_CATEGORIES } from '@/lib/categories'
import { ACCESSORY_LINKS } from './AccessoriesNavGroup'

// The only mobile-visible way to browse categories -- SiteHeader's full nav
// (NAV_CATEGORIES + AccessoriesNavGroup) is `hidden md:flex` with no fallback
// otherwise, so a mobile visitor not already on the homepage had no path to
// any category short of the footer or search. Reuses the exact same link
// data SiteHeader/AccessoriesNavGroup already define (re-exported from
// those files) rather than duplicating the list, so it can never drift out
// of sync with the desktop nav.
export function MobileNav() {
  const [open, setOpen] = useState(false)

  // Lock background scroll while the panel is open, and let Escape close it
  // -- standard drawer/overlay behavior, matching the outside-click-to-close
  // pattern already used by AccessoriesNavGroup/HeaderSearch.
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-secondary/60"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 flex w-[80%] max-w-xs flex-col overflow-y-auto border-r border-border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="font-heading text-base font-bold tracking-tight text-foreground">
                Digital<span className="text-brand-orange">Bluez</span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <nav className="flex flex-col px-2 py-2">
              {NAV_CATEGORIES.map((c) => (
                <Link
                  key={c.code}
                  href={`/${categoryToSlug(c.code)}`}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary/60 hover:text-brand-orange"
                >
                  {c.label}
                </Link>
              ))}

              <p className="mt-2 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Accessories
              </p>
              {ACCESSORY_LINKS.map((c) => (
                <Link
                  key={c.code}
                  href={`/${categoryToSlug(c.code)}`}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary/60 hover:text-brand-orange"
                >
                  {c.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
    </div>
  )
}
