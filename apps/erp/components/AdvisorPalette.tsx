'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import navEntries from '@/lib/advisor/generated-nav.json'

interface NavEntry { label: string; route: string; pageKey?: string; ownerOnly?: boolean }
const NAV_ENTRIES = navEntries as NavEntry[]
const MAX_PAGE_MATCHES = 6

// DB's ask palette (Phase 1: read-only, no LLM -- see docs/decisions.md
// 2026-08-29). Deliberately framed as a search box with live results, not a chat
// window: most questions here resolve to a specific number/record/page, and a
// ranked-as-you-type list gets you there faster and more honestly than a chat
// bubble pretending to "think" about a deterministic lookup.
//
// shouldFilter is not set on the underlying Command -- there's no local `items`
// list to filter; the single displayed card comes straight from the server.

interface AdvisorLine { label: string; value: string }
interface AdvisorCard {
  kind: string
  title: string
  subtitle?: string
  lines: AdvisorLine[]
  href?: string
  sourceLabel: string
}

const DEBOUNCE_MS = 250

export default function AdvisorPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [text, setText] = useState('')
  const [card, setCard] = useState<AdvisorCard | null>(null)
  const [loading, setLoading] = useState(false)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const router = useRouter()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)
  const { isOwner, hasPageAccess } = useRole()

  // Synchronous, client-side "jump to page" matches -- no debounce/API round trip
  // needed since generated-nav.json is a small static list already in the bundle.
  // Rendered as its own CommandGroup above the debounced Ask-DB answer card below.
  const pageMatches = useMemo(() => {
    const query = text.trim().toLowerCase()
    if (!query) return []
    return NAV_ENTRIES
      .filter(e => (isOwner || !e.ownerOnly) && (isOwner || !e.pageKey || hasPageAccess(e.pageKey)))
      .filter(e => e.label.toLowerCase().includes(query))
      .slice(0, MAX_PAGE_MATCHES)
  }, [text, isOwner, hasPageAccess])

  useEffect(() => {
    if (!open) {
      setText('')
      setCard(null)
      setDurationMs(null)
    }
  }, [open])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!text.trim()) {
      setCard(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const thisRequestId = ++requestIdRef.current
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch('/api/advisor/ask', { method: 'POST', body: JSON.stringify({ text }) })
        if (thisRequestId !== requestIdRef.current) return // a newer keystroke superseded this request
        const data = await res.json()
        if (res.ok) {
          setCard(data.card)
          setDurationMs(data.durationMs ?? null)
        } else {
          setCard(null)
        }
      } catch {
        if (thisRequestId === requestIdRef.current) setCard(null)
      } finally {
        if (thisRequestId === requestIdRef.current) setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [text])

  const go = () => {
    if (card?.href) {
      router.push(card.href)
      onOpenChange(false)
    }
  }

  const goToPage = (route: string) => {
    router.push(route)
    onOpenChange(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Ask DB" description="Ask about a report, a record number, how to do something, or where a page is.">
      <Command shouldFilter={false}>
      <CommandInput
        placeholder="Search a page, or ask DB — revenue this month, DBI2026-681, how to sell a laptop..."
        value={text}
        onValueChange={setText}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !pageMatches.length && card?.href) go()
        }}
      />
      <CommandList>
        {!text.trim() && (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            Try: <span className="font-medium">&ldquo;repair jobs&rdquo;</span>,{' '}
            <span className="font-medium">&ldquo;RMA&rdquo;</span>,{' '}
            <span className="font-medium">&ldquo;revenue this month&rdquo;</span>,{' '}
            <span className="font-medium">&ldquo;DBI2026-681&rdquo;</span>
          </div>
        )}
        {pageMatches.length > 0 && (
          <CommandGroup heading="Pages">
            {pageMatches.map(entry => (
              <CommandItem key={entry.route} value={`page-${entry.route}`} onSelect={() => goToPage(entry.route)}>
                {entry.label}
                <span className="ml-auto text-xs text-muted-foreground">{entry.route}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {text.trim() && loading && !card && (
          <div className="px-4 py-6 text-sm text-muted-foreground">Searching…</div>
        )}
        {text.trim() && !loading && !card && !pageMatches.length && <CommandEmpty>No answer found for that yet.</CommandEmpty>}
        {card && (
          <CommandGroup heading={card.sourceLabel}>
            <CommandItem value={card.title} onSelect={go} className="flex-col items-start gap-1 py-3">
              <div className="flex w-full items-baseline justify-between gap-2">
                <span className="font-semibold">{card.title}</span>
                {durationMs != null && <span className="text-xs text-muted-foreground">{durationMs}ms</span>}
              </div>
              {card.subtitle && <div className="text-sm text-muted-foreground">{card.subtitle}</div>}
              <div className="mt-1 w-full space-y-0.5">
                {card.lines.map((line, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    {line.label && <span className="text-muted-foreground">{line.label}</span>}
                    <span className="font-medium tabular-nums">{line.value}</span>
                  </div>
                ))}
              </div>
              {card.href && <div className="mt-1 text-xs text-primary">Press Enter to open →</div>}
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
