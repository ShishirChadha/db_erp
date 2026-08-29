// The advisor's single entry point (Phase 1: read-only). Runs the deterministic
// router (lib/advisor/router.ts) and logs every question to advisor_queries
// (the miss log) regardless of outcome -- whether a resolver matched is itself the
// signal that drives what gets written into the Bible next. No LLM anywhere in this
// path; see docs/decisions.md (2026-08-29) for why.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'
import { route } from '@/lib/advisor/router'

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 })
  if (text.length > 500) return NextResponse.json({ error: 'text is too long' }, { status: 400 })

  const startedAt = Date.now()
  let result: Awaited<ReturnType<typeof route>> = null
  try {
    result = await route({ user: sessionUser, text })
  } catch (err: any) {
    // Log the miss even on a resolver-side failure -- a broken resolver is exactly
    // the kind of thing the miss log should surface, not swallow.
    await logQuery(text, null, sessionUser, Date.now() - startedAt)
    return NextResponse.json({ error: err.message || 'Advisor query failed' }, { status: 500 })
  }

  const durationMs = Date.now() - startedAt
  await logQuery(text, result?.resolver ?? null, sessionUser, durationMs)

  if (!result) {
    return NextResponse.json({ card: null, durationMs })
  }
  return NextResponse.json({ card: result.card, durationMs })
}

async function logQuery(text: string, resolver: string | null, user: { id: string; role: string }, durationMs: number) {
  await supabaseAdmin.from('advisor_queries').insert({
    raw_text: text,
    matched_resolver: resolver,
    role: user.role,
    user_id: user.id,
    duration_ms: durationMs,
  })
}
