import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { liveSessionByCode, readJsonLimited } from '@/lib/qc-agent/session'
import { COSMETIC_AREAS, COSMETIC_LEVELS, CHECK_BY_KEY } from '@/lib/qc-agent/checklist'
import type { GuidedAnswer, InteractiveResults, CosmeticLevel } from '@/lib/qc-agent/types'

// POST -- answers from the no-login /qc-test page on the laptop. Code-only.
// Merged key by key into interactive_results, so each step can save on its own.
// Keys are whitelisted: guided check keys, plus the two lock questions the
// page asks (bios_prompt, oobe_company).

const EXTRA_ANSWER_KEYS = new Set(['bios_prompt', 'oobe_company'])
const COSMETIC_KEYS = new Set(COSMETIC_AREAS.map((a) => a.key))
const LEVEL_KEYS = new Set<string>(COSMETIC_LEVELS.map((l) => l.key))

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const found = await liveSessionByCode(code)
  if ('error' in found) return found.error
  const parsed = await readJsonLimited(req)
  if ('error' in parsed) return parsed.error
  const { row } = found
  const body = parsed.body
  const cur: InteractiveResults = row.interactive_results || {}
  const next: InteractiveResults = { ...cur, answers: { ...(cur.answers || {}) }, cosmetic: { ...(cur.cosmetic || {}) } }

  if (body.answers && typeof body.answers === 'object') {
    for (const [key, raw] of Object.entries(body.answers as Record<string, any>)) {
      const allowed = (CHECK_BY_KEY[key] && CHECK_BY_KEY[key].kind === 'guided') || EXTRA_ANSWER_KEYS.has(key)
      if (!allowed) continue
      if (raw === null) { delete next.answers![key]; continue }
      if (!raw || !['pass', 'fail', 'na'].includes(raw.result)) continue
      const answer: GuidedAnswer = { result: raw.result }
      if (typeof raw.note === 'string' && raw.note.trim()) answer.note = raw.note.trim().slice(0, 500)
      next.answers![key] = answer
    }
  }
  if (body.cosmetic && typeof body.cosmetic === 'object') {
    for (const [key, level] of Object.entries(body.cosmetic as Record<string, any>)) {
      if (COSMETIC_KEYS.has(key) && LEVEL_KEYS.has(level)) next.cosmetic![key] = level as CosmeticLevel
    }
  }
  if (typeof body.usb_ports_declared === 'number' && body.usb_ports_declared >= 0 && body.usb_ports_declared <= 12) {
    next.usb_ports_declared = Math.round(body.usb_ports_declared)
  }
  if (body.command === 'brightness_sweep') next.command = { name: 'brightness_sweep', at: new Date().toISOString() }
  if (typeof body.finished === 'boolean') next.finished = body.finished

  const { error } = await supabaseAdmin.from('qc_agent_sessions').update({ interactive_results: next }).eq('id', row.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, interactive: next })
}
