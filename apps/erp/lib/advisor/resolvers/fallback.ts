// Resolver 7 (last resort): nothing matched a specific intent. Rather than a bare
// "I don't understand", offer the best Bible full-text hits as "did you mean" chips
// -- still zero-model, still one indexed query, and it's what actually improves over
// time: this path is exactly what advisor_queries' miss log is watching for.
import { supabaseAdmin } from '@/lib/supabase/service'
import type { AdvisorResult, ResolverContext } from '../types'

export async function resolveFallback(ctx: ResolverContext): Promise<AdvisorResult | null> {
  const { data } = await supabaseAdmin.rpc('kb_search', { p_query: ctx.text, p_role: ctx.user.role, p_limit: 3 })

  if (!data || data.length === 0) return null

  return {
    resolver: 'fallback',
    card: {
      kind: 'fallback',
      title: 'Did you mean...',
      lines: data.map((d: { title: string; summary: string | null }) => ({ label: d.title, value: d.summary || '' })),
      sourceLabel: 'Bible search',
    },
  }
}
