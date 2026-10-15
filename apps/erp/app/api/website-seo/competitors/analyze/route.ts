import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { guardedFetch } from '@/lib/net-guard'
import { analyzeSite } from '@/lib/seo-competitor'

// A run makes at most ~14 requests; give it room on a slow site.
export const maxDuration = 60

const COOLDOWN_MS = 60 * 60 * 1000 // one analysis per site per hour -- be polite to other people's servers
const KEEP_SNAPSHOTS = 5

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = (await req.json()) as { id?: string }
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { data: site } = await supabaseAdmin.from('seo_competitors').select('*').eq('id', id).maybeSingle()
  if (!site) return NextResponse.json({ error: 'Website not found' }, { status: 404 })

  if (site.last_analyzed_at) {
    const wait = COOLDOWN_MS - (Date.now() - new Date(site.last_analyzed_at).getTime())
    if (wait > 0) {
      return NextResponse.json({ error: `Analysed recently. To keep load on their site low, you can run it again in ${Math.ceil(wait / 60000)} minutes.` }, { status: 429 })
    }
  }
  // Claim the slot first so two quick clicks cannot start two runs.
  await supabaseAdmin.from('seo_competitors').update({ last_analyzed_at: new Date().toISOString() }).eq('id', id)

  let signals = null
  let errorMessage: string | null = null
  try {
    signals = await analyzeSite(site.base_url, (url) => guardedFetch(url))
    if (!signals.pages.home && !signals.sitemap.ok) errorMessage = signals.notes[0] ?? 'Nothing could be read from this website'
  } catch (e: any) {
    errorMessage = e?.message ?? 'Analysis failed'
  }

  await supabaseAdmin.from('seo_competitor_snapshots').insert({ competitor_id: id, signals, error: errorMessage })
  const { data: all } = await supabaseAdmin.from('seo_competitor_snapshots').select('id').eq('competitor_id', id).order('fetched_at', { ascending: false })
  const old = (all ?? []).slice(KEEP_SNAPSHOTS).map((s) => s.id)
  if (old.length) await supabaseAdmin.from('seo_competitor_snapshots').delete().in('id', old)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'settings',
    tableName: 'seo_competitors',
    recordId: id,
    recordLabel: `Analysed ${site.label}`,
    metadata: { ok: !errorMessage, requests: signals?.requests ?? 0 },
  })
  return NextResponse.json({ ok: !errorMessage, error: errorMessage, requests: signals?.requests ?? 0 })
}
