import { supabaseAdmin } from '@/lib/supabase/service'
import type { SiteSignals } from '@/lib/seo-competitor'
import { buildCompetitorIdeas, type Idea } from '@/lib/seo-competitor-ideas'

// Tracked websites with their latest analysis and the ideas from comparing each
// with our own site's latest analysis. Shared by the Competitors screen and Suggestions.

export interface CompetitorWithIdeas {
  id: string
  label: string
  base_url: string
  is_self: boolean
  last_analyzed_at: string | null
  snapshot: { fetched_at: string; signals: SiteSignals | null; error: string | null } | null
  ideas: Idea[]
  [k: string]: any
}

export async function loadCompetitorsWithIdeas(): Promise<CompetitorWithIdeas[]> {
  const { data: sites, error } = await supabaseAdmin.from('seo_competitors').select('*').order('is_self', { ascending: false }).order('label')
  if (error) throw new Error(error.message)

  const { data: snaps } = await supabaseAdmin
    .from('seo_competitor_snapshots')
    .select('competitor_id, fetched_at, signals, error')
    .order('fetched_at', { ascending: false })
    .limit(200)
  const latest = new Map<string, { fetched_at: string; signals: SiteSignals | null; error: string | null }>()
  for (const s of snaps ?? []) if (!latest.has(s.competitor_id)) latest.set(s.competitor_id, s as any)

  const self = (sites ?? []).find((s) => s.is_self)
  const selfSignals = self ? latest.get(self.id)?.signals ?? null : null

  return (sites ?? []).map((s) => {
    const snap = latest.get(s.id) ?? null
    return { ...s, snapshot: snap, ideas: !s.is_self && snap?.signals ? buildCompetitorIdeas(selfSignals, snap.signals, s.label) : [] }
  })
}
