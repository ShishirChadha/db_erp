// Resolver 4: "where is...", "where do I...", "open..." resolves to a page in the
// nav, via generated-nav.json -- a flat JSON copy of components/sidebar.tsx's own
// menu structure, rebuilt by scripts/bible/generate.ts. A plain JSON import, so this
// never does a runtime fs read or DB round trip -- the fastest resolver in the router.
import { hasPageAccess, isOwner } from '@/lib/auth/session'
import navEntries from '../generated-nav.json'
import type { AdvisorResult, ResolverContext } from '../types'

const LOCATE_RE = /\bwhere\s*(is|do|can|are)\b|\bopen\s+the\b|\bfind\s*the\s*page\b|\bkahan\b/i
const STRIP_RE = /\b(where\s*(is|do|can|are)\s*i?|open\s+the|find\s*the\s*page|kahan)\b/gi

interface NavEntry { label: string; route: string; pageKey?: string; ownerOnly?: boolean }

export async function resolveLocate(ctx: ResolverContext): Promise<AdvisorResult | null> {
  if (!LOCATE_RE.test(ctx.text)) return null

  const query = ctx.text.replace(STRIP_RE, ' ').trim().toLowerCase()
  if (query.length < 2) return null

  const entries = navEntries as NavEntry[]
  const words = query.split(/\s+/).filter((w) => w.length > 2)

  let best: NavEntry | null = null
  let bestScore = 0
  for (const entry of entries) {
    const label = entry.label.toLowerCase()
    let score = 0
    if (label.includes(query)) score += 10
    for (const w of words) if (label.includes(w)) score += 1
    if (score > bestScore) { bestScore = score; best = entry }
  }
  if (!best || bestScore === 0) return null

  const accessible = best.ownerOnly ? isOwner(ctx.user) : !best.pageKey || hasPageAccess(ctx.user, best.pageKey)

  return {
    resolver: 'locate',
    card: {
      kind: 'locate',
      title: best.label,
      lines: [
        { label: 'Route', value: best.route },
        { label: 'Access', value: accessible ? 'You can open this' : best.ownerOnly ? 'Owner only' : 'Requires a page grant you don\'t currently have' },
      ],
      href: accessible ? best.route : undefined,
      sourceLabel: 'Navigation',
    },
  }
}
