'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { categoryToSlug } from '@/lib/categories'

// Accessories has no real "sub-category" concept in the schema (ADP/RAM/SSD/
// KBD/MOUSE are all flat, sibling sku_category_templates rows, each with its
// own working page/slug) -- this is a pure navigation grouping, not a data
// change: gives ADP ("Adapters/Chargers", 27 SKUs, previously linked from
// nowhere) and the other accessory-family categories a visible home under one
// "Accessories" nav item instead of each needing its own top-level slot.
const ACCESSORY_LINKS = [
  { code: 'ACC', label: 'All Accessories' },
  { code: 'ADP', label: 'Adapters / Chargers' },
  { code: 'RAM', label: 'RAM' },
  { code: 'SSD', label: 'SSD' },
  { code: 'KBD', label: 'Keyboards' },
  { code: 'MOUSE', label: 'Mouse' },
]

export function AccessoriesNavGroup() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-brand-orange"
      >
        Accessories
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-52 rounded-xl border border-border bg-card py-1.5 shadow-lg">
          {ACCESSORY_LINKS.map((c) => (
            <Link
              key={c.code}
              href={`/${categoryToSlug(c.code)}`}
              onClick={() => setOpen(false)}
              className="block px-3.5 py-2 text-sm text-foreground transition-colors hover:bg-secondary/60 hover:text-brand-orange"
            >
              {c.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
