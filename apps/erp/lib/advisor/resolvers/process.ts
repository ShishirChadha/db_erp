// Resolver 3: "how do I...", "steps to...", "kaise..." resolves to a Bible process
// (or module/rule) chapter, rendered as numbered steps -- one indexed Postgres FTS
// query against kb_chapters (populated by scripts/bible/sync.ts from docs/bible/**),
// filtered to chapters whose `audience` includes the caller's role. Never touches an
// LLM: the steps shown are exactly what's written in the chapter, verbatim.
import { supabaseAdmin } from '@/lib/supabase/service'
import type { AdvisorResult, ResolverContext } from '../types'

const ACTION_RE = /\bhow\s*(do|to|can)\b|\bsteps?\s*(to|for)\b|\bkaise\b|\bprocess\s*for\b|\bhow\s*do\s*i\b/i

// Strip the trigger phrase itself before handing the remainder to full-text search --
// "how do I sell a laptop" should search on "sell a laptop", not the whole sentence.
const STRIP_RE = /\b(how\s*(do|can)\s*i|how\s*to|steps?\s*(to|for)|kaise|process\s*for)\b/gi

export async function resolveProcess(ctx: ResolverContext): Promise<AdvisorResult | null> {
  if (!ACTION_RE.test(ctx.text)) return null

  const query = ctx.text.replace(STRIP_RE, ' ').trim()
  if (query.length < 2) return null

  // Ranked search (kb_search RPC): PostgREST's .textSearch() filters but does not
  // order by relevance, which let an arbitrary match win over the best one -- caught
  // during verification ("how do I sell a laptop" was resolving to live-stock-qc.md
  // instead of sell-a-unit.md). kb_search does the ts_rank ordering PostgREST can't.
  const { data, error } = await supabaseAdmin.rpc('kb_search', { p_query: query, p_role: ctx.user.role, p_limit: 1 })

  if (error || !data || data.length === 0) return null
  const chapter = data[0]

  const steps = extractSteps(chapter.body_md)

  return {
    resolver: 'process',
    card: {
      kind: 'process',
      title: chapter.title,
      subtitle: chapter.summary || undefined,
      lines: steps.length > 0
        ? steps.map((s, i) => ({ label: String(i + 1), value: s }))
        : [{ label: '', value: chapter.summary || 'See the full chapter for details.' }],
      href: `/dashboard/advisor/bible/${chapter.slug}`,
      sourceLabel: `Bible → ${chapter.title}`,
    },
  }
}

// Pull the numbered list under a "## Steps" (or similarly named) heading, if the
// chapter has one -- most process chapters do. Falls back to the summary otherwise.
function extractSteps(bodyMd: string): string[] {
  const m = /##\s*Steps[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i.exec(bodyMd)
  if (!m) return []
  return m[1]
    .split('\n')
    .filter((l) => /^\d+\.\s/.test(l.trim()))
    .map((l) => l.trim().replace(/^\d+\.\s*/, ''))
}
