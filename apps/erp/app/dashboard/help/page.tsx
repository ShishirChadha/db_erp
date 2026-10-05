'use client'

// DB Guide -- a browsable index over the kb_chapters content synced from
// docs/bible/** (see scripts/bible/sync.ts). No RequirePageAccess/RequireOwner
// wrapper: deliberately visible to every signed-in role with zero admin setup,
// same pattern as app/dashboard/settings/page.tsx's SettingsPageGuarded --
// app/dashboard/layout.tsx's own "redirect to /login if no session" check is
// the only gate this page needs. Audience filtering happens server-side in
// GET /api/db-guide (kb_chapters' own RLS is SELECT-open with no audience
// filter, so that route's filter -- not this page -- is the real boundary).
//
// This used to be one of two read surfaces over the Bible, alongside an
// "Ask DB" ⌘K Q&A palette (intent router + report/record lookups). That
// palette was removed 2026-09-16 in favor of this page as the sole surface
// -- see docs/decisions.md. The sidebar's ⌘K "Search..." is unrelated: a
// separate, much simpler page-jump search (NavSearchPalette), not a Bible
// reader.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Search,
  type LucideIcon,
  Package,
  CalendarDays,
  CalendarCheck,
  ShieldCheck,
  Users,
  Receipt,
  TrendingUp,
  Barcode,
  Laptop,
  Megaphone,
  ShoppingCart,
  Scale,
  Wrench,
  Settings,
  Globe,
  BookOpen,
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { ErrorBanner } from '@/components/ErrorBanner'

// Per-module icon, purely decorative -- reuses sidebar.tsx's icon choices
// where a module maps onto a real nav group, so the same feature always
// looks the same everywhere. A module with no entry here (or a future one)
// falls back to a plain book icon rather than breaking.
const MODULE_ICONS: Record<string, LucideIcon> = {
  accessories: Package,
  'activities-notifications': CalendarDays,
  attendance: CalendarCheck,
  'backup-audit': ShieldCheck,
  'customers-vendors': Users,
  expenses: Receipt,
  'finance-gst-reports': TrendingUp,
  'inventory-sku': Barcode,
  'live-stock-qc': Laptop,
  marketing: Megaphone,
  purchasing: ShoppingCart,
  reconciliation: Scale,
  rentals: CalendarCheck,
  'repairs-replacements-rma': Wrench,
  'sales-invoicing': TrendingUp,
  'settings-admin': Settings,
  website: Globe,
}

interface ChapterListItem {
  slug: string
  title: string
  kind: 'module' | 'process' | 'rule'
  module: string | null
  summary: string
  routes: string[]
  keywords: string[]
  updated_at: string
}

export default function HelpCenterPage() {
  const [chapters, setChapters] = useState<ChapterListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/db-guide')
      .then(async (res) => {
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) { setError(data.error || 'Failed to load'); return }
        setChapters(data)
      })
      .catch(() => !cancelled && setError('Failed to load help content'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [])

  // Word-level AND matching, not whole-phrase substring -- a chapter whose
  // "accessory"/"accessories" and "replacement" live as two separate
  // keywords should still match a query typed as one phrase ("accessories
  // replacement"), in either word order. Every typed word must appear
  // somewhere across title/summary/keywords; found this the hard way when
  // real content existed but a two-word search came up empty.
  const qWords = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (c: ChapterListItem) => {
    if (qWords.length === 0) return true
    const haystack = `${c.title} ${c.summary} ${c.keywords.join(' ')}`.toLowerCase()
    return qWords.every((w) => haystack.includes(w))
  }

  const modules = useMemo(
    () => (chapters ?? []).filter((c) => c.kind === 'module').sort((a, b) => a.title.localeCompare(b.title)),
    [chapters]
  )
  const processesByModule = useMemo(() => {
    const map = new Map<string, ChapterListItem[]>()
    for (const c of chapters ?? []) {
      if (c.kind === 'process' && c.module) {
        if (!map.has(c.module)) map.set(c.module, [])
        map.get(c.module)!.push(c)
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.title.localeCompare(b.title))
    return map
  }, [chapters])
  const orphanProcesses = (chapters ?? []).filter((c) => c.kind === 'process' && !c.module)
  const rules = (chapters ?? []).filter((c) => c.kind === 'rule')

  const chapterHref = (slug: string) => `/dashboard/help/${slug}`

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">DB Guide</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Every feature, how-to steps, and the rules behind how this app behaves.
      </p>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search DB Guide..."
          className="w-full rounded-md border pl-9 pr-3 py-2 text-sm bg-background"
        />
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <ErrorBanner message={error} />}

      <div className="grid gap-4 sm:grid-cols-2 mb-6">
        {modules.map((mod) => {
          const children = (processesByModule.get(mod.slug) ?? []).filter(matches)
          if (qWords.length > 0 && !matches(mod) && children.length === 0) return null
          const Icon = MODULE_ICONS[mod.slug] ?? BookOpen
          return (
            <section key={mod.slug} className="rounded-lg border p-4">
              <Link href={chapterHref(mod.slug)} className="flex items-start gap-3 hover:underline">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-base font-semibold leading-tight">{mod.title}</span>
              </Link>
              {mod.summary && <p className="mt-1 text-sm text-muted-foreground">{mod.summary}</p>}
              {children.length > 0 && (
                <ul className="mt-3 space-y-1 border-t pt-3">
                  {children.map((p) => (
                    <li key={p.slug}>
                      <Link href={chapterHref(p.slug)} className="text-sm text-primary hover:underline">
                        {p.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>


      {orphanProcesses.filter(matches).length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-2">Other how-to guides</h2>
          <ul className="space-y-1 pl-4">
            {orphanProcesses.filter(matches).map((p) => (
              <li key={p.slug}>
                <Link href={chapterHref(p.slug)} className="text-sm text-primary hover:underline">
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rules.filter(matches).length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-2">Rules & policies</h2>
          <ul className="space-y-1 pl-4">
            {rules.filter(matches).map((r) => (
              <li key={r.slug}>
                <Link href={chapterHref(r.slug)} className="text-sm text-primary hover:underline">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
